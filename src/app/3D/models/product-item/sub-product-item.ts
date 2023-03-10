import type { ProductConfigurationEvent } from '../../../shared/events/product-configurator-events';
import type { MaterialTextureSwapEventData } from '../event-data/material-texture-swap-event-data';

export interface SubProductItem {
  id: number;
  image: string;
  tooltip: string;
  data?: MaterialTextureSwapEventData;
  eventType: ProductConfigurationEvent;
}
