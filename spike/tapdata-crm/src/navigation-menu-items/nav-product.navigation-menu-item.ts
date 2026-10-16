import {
  NavigationMenuItemType,
  defineNavigationMenuItem,
} from 'twenty-sdk/define';
import { OBJECT_UI } from '../ids';

export default defineNavigationMenuItem({
  universalIdentifier: 'ab05effd-9dcc-4119-af0f-4333e0408abf',
  position: 102,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: OBJECT_UI["product"],
});
