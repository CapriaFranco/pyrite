import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { FinancesService } from '../../bll/finances/finances.service';
import type { MovementInput } from '../../bll/finances/movement-input';
import { DisputesIntakeService } from '../../bll/disputes/disputes-intake.service';

@Controller('finances')
export class FinancesController {
  constructor(
    private readonly finances: FinancesService,
    private readonly intake: DisputesIntakeService,
  ) {}

  @Get('movements')
  listMovements() {
    return this.finances.listMovements();
  }

  /**
   * The movement is saved by finances and then shown to the dispute engine (spec 025): the
   * composition lives here, in the gateway, so the finances domain does not import the engine and
   * the engine's answer is an extra on the response, never a condition to save.
   */
  @Post('movements')
  async createMovement(@Body() body: MovementInput) {
    const movement = (await this.finances.createMovement(body, body?.rateUsed)) as { id: string };
    const intake = await this.intake.intakeForSaved(movement.id);
    return intake ? { ...movement, intake } : movement;
  }

  /**
   * A session of movements as one operation (spec 029): finances writes the whole list as one unit
   * and the gateway then asks the engine about each saved movement, in the order they were sent.
   * The intake runs after the commit, one call per movement, and each answer travels with its item;
   * a failure is already swallowed by `intakeForSaved`, so it can neither undo the batch nor cost
   * the answer of another item.
   */
  @Post('movements/batch')
  async createMovementBatch(@Body() body: { movements?: unknown }) {
    const saved = await this.finances.createMovementBatch(body?.movements);
    const items = [];
    for (const [index, movement] of saved.entries()) {
      const intake = await this.intake.intakeForSaved(movement.id);
      items.push(intake ? { index, movement, intake } : { index, movement });
    }
    return { saved: items.length, items };
  }

  @Delete('movements/:id')
  softDeleteMovement(@Param('id') id: string) {
    return this.finances.softDeleteMovement(id);
  }

  @Get('categories')
  listCategories() {
    return this.finances.listCategories();
  }

  @Post('categories')
  createCategory(@Body() body: { name: string; type: 'income' | 'expense'; isService?: boolean }) {
    return this.finances.createCategory(body.name, body.type, body.isService === true);
  }

  /** Marks the category where services and subscriptions land: turns the intake on for it. */
  @Put('categories/:id/service')
  setCategoryService(@Param('id') id: string, @Body() body: { isService: boolean }) {
    return this.finances.setCategoryService(id, body?.isService);
  }

  @Get('platforms')
  listPlatforms() {
    return this.finances.listPlatforms();
  }

  @Post('platforms')
  createPlatform(@Body() body: { name: string }) {
    return this.finances.createPlatform(body.name);
  }

  /** The balance grid: currency -> flow -> amount (spec 026). */
  @Get('balances')
  getBalances() {
    return this.finances.getBalances();
  }

  /** The system currency catalog, read-only. */
  @Get('currencies')
  listCurrencies() {
    return this.finances.listCurrencies();
  }

  /** The manual override of one balance: currency plus flow plus the amount written by hand. */
  @Post('balances')
  setBalance(@Body() body: { currencyCode?: unknown; walletType?: unknown; amount?: unknown }) {
    return this.finances.setBalance(body?.currencyCode, body?.walletType, body?.amount);
  }
}