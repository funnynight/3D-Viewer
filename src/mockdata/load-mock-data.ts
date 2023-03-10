import type { ProductConfiguratorService } from '../app/shared/product-configurator.service';
import { createFlowerPot, createRose, createWuffels } from './unrealistic-items';
import { createIkeaChear, createIkeaTable, createWayfairChair, createWayfairTable } from './realistic-items';

export function loadMockData(productConfiguratorService: ProductConfiguratorService): void {
  let id = 0;

  // Who needs a database!
  productConfiguratorService.items.push(createFlowerPot(id++));
  productConfiguratorService.items.push(createRose(id++));
  productConfiguratorService.items.push(createWuffels(id++));
  productConfiguratorService.items.push(createWayfairTable(id++));
  productConfiguratorService.items.push(createWayfairChair(id++));
  productConfiguratorService.items.push(createIkeaChear(id++));
  productConfiguratorService.items.push(createIkeaTable(id++));
}
