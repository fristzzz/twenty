import {
  NavigationMenuItemType,
  defineNavigationMenuItem,
} from 'twenty-sdk/define';
import { OBJECT_UI } from '../ids';

export default defineNavigationMenuItem({
  universalIdentifier: '46834397-8a03-4be3-be31-ac2aa3f2f973',
  position: 104,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: OBJECT_UI["contractItem"],
});
