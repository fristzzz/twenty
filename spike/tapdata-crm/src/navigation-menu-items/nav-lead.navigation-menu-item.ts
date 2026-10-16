import {
  NavigationMenuItemType,
  defineNavigationMenuItem,
} from 'twenty-sdk/define';
import { IDS, OBJECT_UI } from '../ids';

export default defineNavigationMenuItem({
  universalIdentifier: IDS["nav:lead"],
  position: 106,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: OBJECT_UI["lead"],
});
