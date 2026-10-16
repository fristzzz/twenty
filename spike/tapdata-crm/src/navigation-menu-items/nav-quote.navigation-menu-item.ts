import {
  NavigationMenuItemType,
  defineNavigationMenuItem,
} from 'twenty-sdk/define';
import { OBJECT_UI } from '../ids';

export default defineNavigationMenuItem({
  universalIdentifier: '364196a1-8081-40e1-ab5f-07101e407430',
  position: 101,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: OBJECT_UI["quote"],
});
