import {
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'twenty-sdk/define';
import { IDS, OBJECT_UI } from '../ids';

export const FIELD_ID = IDS["field:product.contractItems"];

export default defineField({
  universalIdentifier: FIELD_ID,
  objectUniversalIdentifier: OBJECT_UI["product"],
  type: FieldType.RELATION,
  name: "contractItems",
  label: "合同行",
  icon: 'IconRelationManyToMany',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: OBJECT_UI["contractItem"],
  relationTargetFieldMetadataUniversalIdentifier: IDS["field:contractItem.product"],
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
