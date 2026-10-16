import {
  NavigationMenuItemType,
  defineNavigationMenuItem,
} from 'twenty-sdk/define';
import { OBJECT_UI } from '../ids';

export default defineNavigationMenuItem({
  universalIdentifier: '9b2ce360-a837-4b13-9f91-ea58c9a9d450',
  position: 103,
  type: NavigationMenuItemType.OBJECT,
  targetObjectUniversalIdentifier: OBJECT_UI["installment"],
});
