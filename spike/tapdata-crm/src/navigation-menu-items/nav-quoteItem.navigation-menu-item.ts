import {
  NavigationMenuItemType,
  defineNavigationMenuItem,
} from 'twenty-sdk/define';
import { OBJECT_UI } from '../ids';

export default defineNavigationMenuItem({
  universalIdentifier: 'f8e6fc2e-d06c-4873-b8d8-4bb17365367f',
  position: 105,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: OBJECT_UI["quoteItem"],
});
