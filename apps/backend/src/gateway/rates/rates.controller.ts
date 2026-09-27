import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { RatesService, type RateEntry } from '../../bll/rates/rates.service';

@Controller('rates')
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  @Get('latest')
  async latest(
    @Query('type') type = 'blue',
    @Query('base') base?: string,
    @Query('quote') quote?: string,
  ): Promise<RateEntry | undefined> {
    return this.rates.getLatest(type, base, quote);
  }

  @Get('series')
  async series(
    @Query('type') type = 'blue',
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('base') base?: string,
    @Query('quote') quote?: string,
  ): Promise<RateEntry[]> {
    return this.rates.getSeries(type, from, to, base, quote);
  }

  /**
   * The rate of a pair (spec 027): it resolves whichever way the pair exists (direct, inverse or
   * through the base currency) and says which one it used.
   */
  @Get('convert')
  convert(@Query('from') from?: string, @Query('to') to?: string, @Query('type') type?: string) {
    return this.rates.convert(from, to, type);
  }

  @Get('base-currency')
  baseCurrency(): { baseCurrency: string } {
    return { baseCurrency: this.rates.baseCurrency() };
  }

  @Post('base-currency')
  setBaseCurrency(@Body() body: { baseCurrency?: unknown }): Promise<{ baseCurrency: string }> {
    return this.rates.setBaseCurrency(body?.baseCurrency);
  }

  @Post('sync')
  async sync(): Promise<{ ok: boolean; count: number }> {
    const count = await this.rates.reconcileFull();
    await this.rates.refreshIntradia();
    return { ok: true, count };
  }
}