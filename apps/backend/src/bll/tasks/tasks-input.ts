import { frequencyUnitEnum, leapDayModeEnum, paymentModeEnum, recurrenceEndModeEnum, taskPriorityEnum, taskStateEnum, taskStatusEnum, taskTypeEnum, trialUnitEnum } from '../../../drizzle/schema';
import { isCurrencyCode } from '../../types/currencies';
import type { Currency, TaskPaymentRow, TaskRecurrenceRow, TaskStatus, TaskType } from '../../dal/tasks/tasks.repository';

/** Column enums derive from the schema, so a new value is one edit in one place. */
export type TaskPriority = (typeof taskPriorityEnum.enumValues)[number];
export type TaskState = (typeof taskStateEnum.enumValues)[number];
export type LeapDayMode = (typeof leapDayModeEnum.enumValues)[number];
export type TrialUnit = (typeof trialUnitEnum.enumValues)[number];

/**
 * Input contract of the calendar/tasks API plus its boundary guards. Validation
 * lives here so every entry point shares one source, same rule as counts-input.
 */

export type FrequencyUnit = TaskRecurrenceRow['frequencyUnit'];
export type RecurrenceEndMode = TaskRecurrenceRow['endsMode'];
export type PaymentMode = TaskPaymentRow['mode'];

export interface TaskRecurrenceInput {
  frequencyUnit: FrequencyUnit;
  /** "every N": 1 by default, 3 + `year` is every three years. */
  interval?: number;
  endsMode?: RecurrenceEndMode;
  endsOn?: string | null;
  occurrencesCount?: number | null;
  /** Only for the annual rule: where February 29 lands when the year has no such day. */
  leapDayMode?: LeapDayMode;
  /** Only for the weekly rule: the selected days, each with its own optional hour. */
  weekdays?: TaskWeekdayInput[];
  /** Optional hour of the series; the weekly rule carries one per selected day instead. */
  time?: string | null;
  timeTo?: string | null;
}

/** One selected weekday of a weekly rule; ISO numbering (1 = Monday). */
export interface TaskWeekdayInput {
  weekday: number;
  time?: string | null;
  timeTo?: string | null;
}

/**
 * One dated entry of a punctual task. The simple format is a single row with `date` (and
 * optionally `dateTo` for a range); the multiple format is several rows. `time` and `label`
 * are metadata: the calendar shows the day either way.
 */
export interface TaskDateInput {
  date: string;
  dateTo?: string | null;
  time?: string | null;
  timeTo?: string | null;
  label?: string | null;
}

/** A price tier: the promo that hands over to the regular price. */
export interface TaskTierInput {
  position: number;
  amount?: string | null;
  currency?: Currency;
  appliesFromOccurrence?: number;
}

/**
 * Financial payload of a payment task. A price is optional on purpose: a variable
 * service (rent, utilities) is declared without one and finance fills the real
 * amount later, so the system never invents an estimate. The trial is a quantity
 * plus a unit, so a month of trial is a calendar month.
 */
export interface TaskPaymentInput {
  mode: PaymentMode;
  priceFixed?: boolean;
  priceAmount?: string | null;
  priceCurrency?: Currency;
  trialCount?: number;
  trialUnit?: TrialUnit;
  installmentsCount?: number | null;
  /** @deprecated replaced by trialCount + trialUnit (spec 018): sending it answers 400. */
  trialDays?: unknown;
}

export interface TaskInput {
  title?: string;
  icon?: string | null;
  type?: TaskType;
  status?: TaskStatus;
  /** What has to be done: the focus of the task. */
  description?: string | null;
  /** Extra annotation, kept from v1. */
  notes?: string | null;
  priority?: TaskPriority | null;
  /** What a kanban board renders; null means the task is in no board. */
  state?: TaskState | null;
  groupId?: string | null;
  sectorId?: string | null;
  /** "Otro" in the form: the sector is created (or revived) by name and reused. */
  sectorName?: string | null;
  linkedExpectationId?: string | null;
  startsOn?: string;
  /** Punctual entries: one row is the simple format, several are the multiple one. */
  dates?: TaskDateInput[];
  recurrence?: TaskRecurrenceInput | null;
  payment?: TaskPaymentInput | null;
  tiers?: TaskTierInput[];
}

export interface TaskListQuery {
  type?: string;
  status?: string;
  from?: string;
  to?: string;
  /** Branch filter: the folder and everything under it. */
  group?: string;
  includeDescendants?: string;
}

function fromEnum<T extends string>(values: readonly string[], value: string): value is T {
  return values.includes(value);
}

export function isTaskType(value: string): value is TaskType {
  return fromEnum<TaskType>(taskTypeEnum.enumValues, value);
}

export function isTaskStatus(value: string): value is TaskStatus {
  return fromEnum<TaskStatus>(taskStatusEnum.enumValues, value);
}

export function isFrequencyUnit(value: string): value is FrequencyUnit {
  return fromEnum<FrequencyUnit>(frequencyUnitEnum.enumValues, value);
}

export function isRecurrenceEndMode(value: string): value is RecurrenceEndMode {
  return fromEnum<RecurrenceEndMode>(recurrenceEndModeEnum.enumValues, value);
}

export function isPaymentMode(value: string): value is PaymentMode {
  return fromEnum<PaymentMode>(paymentModeEnum.enumValues, value);
}

/** A currency is a code of the system catalog (spec 026), not an enum of this domain. */
export function isCurrency(value: string): value is Currency {
  return isCurrencyCode(value);
}

export function isTaskPriority(value: string): value is TaskPriority {
  return fromEnum<TaskPriority>(taskPriorityEnum.enumValues, value);
}

export function isTaskState(value: string): value is TaskState {
  return fromEnum<TaskState>(taskStateEnum.enumValues, value);
}

export function isLeapDayMode(value: string): value is LeapDayMode {
  return fromEnum<LeapDayMode>(leapDayModeEnum.enumValues, value);
}

export function isTrialUnit(value: string): value is TrialUnit {
  return fromEnum<TrialUnit>(trialUnitEnum.enumValues, value);
}

/** `HH:MM` in 24 hours: the only time format this API accepts. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isTimeOfDay(value: string): boolean {
  return TIME_PATTERN.test(value);
}
