import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DisputesRepository, type MovementRow } from '../../dal/disputes/disputes.repository';
import { TasksService } from '../tasks/tasks.service';
import { GroupsService, SYSTEM_FINANCES_GROUP } from '../groups/groups.service';
import { SettingsService } from '../settings/settings.service';
import { isUuid } from '../../types/guards';
import { isCurrencyCode, type CurrencyCode } from '../../types/currencies';
import { dayDistance } from './dispute-scorer';
import { matcherConfig } from './dispute-settings';
import { linkReview, windowOf } from './dispute-matcher';
import { FINANCES_GROUP_KEY } from './dispute-intake-settings';

/** What the engine offers to create from a movement it does not recognise (spec 021). */
export interface TaskDraft {
  type: 'pago';
  title: string;
  description: string | null;
  groupId: string;
  startsOn: string;
  recurrence: { frequencyUnit: 'month'; interval: number; endsMode: 'never' };
  payment: {
    mode: 'recurrente';
    priceFixed: boolean;
    priceAmount: string | null;
    priceCurrency: CurrencyCode;
  };
  categoryIds: string[];
}

export type MovementIntakeKind = 'linked' | 'existing_task' | 'new_task' | 'none';

/** The whole answer of the engine to a movement that was just saved. */
export interface MovementIntake {
  kind: MovementIntakeKind;
  taskId?: string;
  expectationId?: string;
  draft?: TaskDraft;
  /** Set when the engine linked it on its own: what the side notification reads. */
  autoLinked?: boolean;
}

/**
 * Intake from finances (spec 021). A movement that lands in a service category either belongs
 * to an expectation the engine can settle, to a task that has no expectation there, or to
 * something new that is worth creating with the payload already filled.
 *
 * It never asks about an ordinary purchase: a category that is not marked as a service and has
 * no payment task declaring it produces no question at all.
 */
@Injectable()
export class DisputesIntakeService {
  private readonly log = new Logger(DisputesIntakeService.name);

  constructor(
    private readonly repo: DisputesRepository,
    private readonly tasks: TasksService,
    private readonly groups: GroupsService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The intake as a step after someone else saved the movement (spec 025). Finances used to call
   * the engine itself, which made a base domain depend on a later one; the gateway composes them
   * now and asks for this. A failure is logged and answers null: the movement is already written,
   * so the engine never turns a save into an error.
   */
  async intakeForSaved(movementId: string): Promise<MovementIntake | null> {
    try {
      return await this.intakeFor(movementId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(`Intake skipped for movement ${movementId}: ${message}`);
      return null;
    }
  }

  /** The decision for one movement. `none` means the engine has nothing to say. */
  async intakeFor(movementId: string): Promise<MovementIntake> {
    const movement = await this.repo.findMovement(movementId);
    if (!movement) throw new NotFoundException('movement not found');
    if (await this.repo.isDismissed(movementId)) return { kind: 'none' };
    if (await this.repo.findLinkByMovement(movementId)) return { kind: 'none' };

    const category = await this.repo.findCategory(movement.categoryId);
    if (!category) return { kind: 'none' };

    const declaredTaskIds = await this.repo.taskIdsDeclaringCategory(movement.categoryId);
    const date = this.dayOf(movement);

    if (declaredTaskIds.length > 0) {
      const match = await this.expectationCovering(declaredTaskIds, date);
      if (match) {
        await this.settle(match.expectationId, movement);
        return { kind: 'linked', taskId: match.taskId, expectationId: match.expectationId, autoLinked: true };
      }
      // The category belongs to a payment task that was not waiting for this money.
      return { kind: 'existing_task', taskId: declaredTaskIds[0] };
    }

    // Only a marked category asks: an ordinary expense never bothers anybody.
    if (!category.isService) return { kind: 'none' };
    return { kind: 'new_task', draft: await this.draftFor(movement) };
  }

  /**
   * The user's answer to the question. `existing_task` links the movement to a task that was
   * already there; `new_task` creates it in the destination group, declares the category and
   * links the movement to the expectation the new series generated.
   */
  async confirm(body: {
    movementId?: unknown;
    kind?: unknown;
    taskId?: unknown;
    draft?: unknown;
  }): Promise<MovementIntake> {
    const movementId = this.uuid(body?.movementId, 'movement id');
    const movement = await this.repo.findMovement(movementId);
    if (!movement) throw new NotFoundException('movement not found');
    if (await this.repo.findLinkByMovement(movementId)) {
      throw new BadRequestException('movement is already linked to an expectation');
    }

    if (body?.kind === 'existing_task') {
      const taskId = this.uuid(body?.taskId, 'task id');
      const expectation = await this.nearestExpectation(taskId, this.dayOf(movement));
      if (!expectation) throw new BadRequestException('the task has no open expectation to settle');
      await this.settle(expectation.id, movement);
      return { kind: 'linked', taskId, expectationId: expectation.id };
    }

    if (body?.kind === 'new_task') {
      const draft = await this.validatedDraft(body?.draft, movement);
      const created = await this.tasks.create({
        title: draft.title,
        type: 'pago',
        description: draft.description,
        groupId: draft.groupId,
        startsOn: draft.startsOn,
        recurrence: draft.recurrence,
        payment: draft.payment,
      });
      const expectation = await this.nearestExpectation(created.id, this.dayOf(movement));
      if (!expectation) throw new BadRequestException('the new task has no expectation to settle');
      // Declaring the category is what makes the next charge of that service link by itself.
      await this.settle(expectation.id, movement, draft.categoryIds);
      this.log.log(`Intake: task ${created.id} created from movement ${movementId}`);
      return { kind: 'linked', taskId: created.id, expectationId: expectation.id };
    }

    throw new BadRequestException('kind must be new_task or existing_task');
  }

  /** "No, it is nothing of the sort": remembered, so it is asked once. */
  async dismiss(movementId: string): Promise<{ movementId: string; dismissed: true }> {
    const id = this.uuid(movementId, 'movement id');
    const movement = await this.repo.findMovement(id);
    if (!movement) throw new NotFoundException('movement not found');
    await this.repo.insertDismissal(id);
    return { movementId: id, dismissed: true };
  }

  // ============ INTERNALS ============

  /**
   * Settles an expectation with a movement, measuring exactly what the matcher measures: the
   * signed deviation and, when it is over the threshold, the review note. Nothing here decides
   * whether the match is good - the intake only links what the declared category and the window
   * already left undoubted.
   */
  private async settle(expectationId: string, movement: MovementRow, categoryIds: string[] = []): Promise<void> {
    const expectation = await this.repo.findExpectation(expectationId);
    if (!expectation) throw new NotFoundException('expectation not found');
    if (categoryIds.length > 0) await this.repo.replaceCategoryLinks(expectation.taskId, categoryIds);

    const review = linkReview(
      expectation.estimatedAmount === null ? null : Number(expectation.estimatedAmount),
      Number(movement.amount),
      matcherConfig(this.settings),
    );
    await this.repo.createLink(
      expectationId,
      movement.id,
      'declared',
      review.amountDeviation === null ? null : String(review.amountDeviation),
      review.reviewNote,
    );
  }

  /** The expectation of those tasks whose window covers the date of the movement. */
  private async expectationCovering(
    taskIds: string[],
    date: string,
  ): Promise<{ taskId: string; expectationId: string } | null> {
    const config = matcherConfig(this.settings);
    const expectations = await this.repo.listExpectationsByTaskIds(taskIds);
    for (const row of expectations) {
      if (row.status !== 'pending') continue;
      if (await this.repo.findLinkByExpectation(row.id)) continue;
      const window = windowOf(row.expectedOn, config);
      if (date >= window.from && date <= window.to) return { taskId: row.taskId, expectationId: row.id };
    }
    return null;
  }

  /** The expectation of a task closest to a date, still waiting for its money. */
  private async nearestExpectation(taskId: string, date: string): Promise<{ id: string } | null> {
    const expectations = (await this.repo.listExpectationsByTaskIds([taskId]))
      .filter((row) => row.status === 'pending' && row.expectedOn <= date)
      .sort((a, b) => Math.abs(dayDistance(a.expectedOn, date)) - Math.abs(dayDistance(b.expectedOn, date)));
    return expectations[0] ? { id: expectations[0].id } : null;
  }

  /**
   * The payload the UI shows already filled: title and note from the movement, the amount as a
   * fixed price because the user just said it is a new subscription, and the destination group
   * (the system `finances/` unless settings point elsewhere, resolved by id).
   */
  private async draftFor(movement: MovementRow): Promise<TaskDraft> {
    return {
      type: 'pago',
      title: movement.description,
      description: movement.note,
      groupId: await this.destinationGroupId(),
      startsOn: this.dayOf(movement),
      recurrence: { frequencyUnit: 'month', interval: 1, endsMode: 'never' },
      payment: {
        mode: 'recurrente',
        priceFixed: true,
        priceAmount: String(movement.amount),
        // The currency of the movement, checked against the system catalog (spec 026).
        priceCurrency: isCurrencyCode(movement.amountCurrency) ? movement.amountCurrency : 'ARS',
      },
      categoryIds: [movement.categoryId],
    };
  }

  /**
   * The destination, always by id: rotating the setting leaves the tasks already created where
   * they are, and a destination that no longer exists falls back to the system group.
   */
  async destinationGroupId(): Promise<string> {
    const configured = this.settings.get(FINANCES_GROUP_KEY);
    if (typeof configured === 'string' && isUuid(configured) && (await this.repo.groupExists(configured))) {
      return configured;
    }
    const system = await this.groups.ensureSystemGroup('tasks', SYSTEM_FINANCES_GROUP);
    return system.id;
  }

  /** A draft coming from the client is validated as an input, never trusted. */
  private async validatedDraft(value: unknown, movement: MovementRow): Promise<TaskDraft> {
    const fallback = await this.draftFor(movement);
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'object') throw new BadRequestException('draft must be an object');
    const input = value as Record<string, unknown>;

    const title = typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : fallback.title;
    const description = typeof input.description === 'string' ? input.description : fallback.description;
    const groupId = isUuid(String(input.groupId ?? '')) ? String(input.groupId) : fallback.groupId;
    if (!(await this.repo.groupExists(groupId))) throw new NotFoundException('destination group not found');
    const startsOn = typeof input.startsOn === 'string' ? input.startsOn : fallback.startsOn;

    const paymentInput = (input.payment ?? {}) as Record<string, unknown>;
    const priceAmount =
      paymentInput.priceAmount === null
        ? null
        : typeof paymentInput.priceAmount === 'string' || typeof paymentInput.priceAmount === 'number'
          ? String(paymentInput.priceAmount)
          : fallback.payment.priceAmount;
    const priceCurrency =
      isCurrencyCode(paymentInput.priceCurrency) ? paymentInput.priceCurrency : fallback.payment.priceCurrency;

    return {
      ...fallback,
      title,
      description,
      groupId,
      startsOn,
      payment: {
        mode: 'recurrente',
        priceFixed: paymentInput.priceFixed !== false,
        priceAmount,
        priceCurrency,
      },
    };
  }

  private dayOf(movement: MovementRow): string {
    return movement.date.toISOString().slice(0, 10);
  }

  private uuid(value: unknown, label: string): string {
    const text = String(value ?? '');
    if (!isUuid(text)) throw new BadRequestException(`invalid ${label}`);
    return text;
  }
}
