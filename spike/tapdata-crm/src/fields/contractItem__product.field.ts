import {
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'twenty-sdk/define';
import { IDS, OBJECT_UI } from '../ids';

export const FIELD_ID = IDS["field:contractItem.product"];

export default defineField({
  universalIdentifier: FIELD_ID,
  objectUniversalIdentifier: OBJECT_UI["contractItem"],
  type: FieldType.RELATION,
  name: "product",
  label: "产品",
  icon: 'IconRelationManyToMany',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: OBJECT_UI["product"],
  relationTargetFieldMetadataUniversalIdentifier: IDS["field:product.contractItems"],
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: "productId",
  },
});
