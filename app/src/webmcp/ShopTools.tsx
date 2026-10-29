// Tools that do not belong to one page. They are registered once and stay while the shop is open.
import { getCart } from '../shop';
import { getCartTool } from './tools';
import { useWebMCPTool } from './useWebMCPTool';

export function ShopTools() {
  useWebMCPTool(getCartTool, async () => JSON.stringify(await getCart()));
  return null;
}
