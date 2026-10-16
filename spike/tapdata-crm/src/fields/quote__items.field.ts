import {
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'twenty-sdk/define';
import { IDS, OBJECT_UI } from '../ids';

export const FIELD_ID = IDS["field:quote.items"];

export default defineField({
  universalIdentifier: FIELD_ID,
  objectUniversalIdentifier: OBJECT_UI["quote"],
  type: FieldType.RELATION,
  name: "items",
  label: "报价行",
  icon: 'IconRelationManyToMany',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: OBJECT_UI["quoteItem"],
  relationTargetFieldMetadataUniversalIdentifier: IDS["field:quoteItem.quote"],
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
