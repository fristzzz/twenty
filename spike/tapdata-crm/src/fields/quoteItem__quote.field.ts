import {
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'twenty-sdk/define';
import { IDS, OBJECT_UI } from '../ids';

export const FIELD_ID = IDS["field:quoteItem.quote"];

export default defineField({
  universalIdentifier: FIELD_ID,
  objectUniversalIdentifier: OBJECT_UI["quoteItem"],
  type: FieldType.RELATION,
  name: "quote",
  label: "所属报价单",
  icon: 'IconRelationManyToMany',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: OBJECT_UI["quote"],
  relationTargetFieldMetadataUniversalIdentifier: IDS["field:quote.items"],
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE,
    joinColumnName: "quoteId",
  },
});
