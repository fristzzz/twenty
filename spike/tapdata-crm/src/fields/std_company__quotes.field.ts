import {
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'twenty-sdk/define';
import { IDS, OBJECT_UI } from '../ids';

export const FIELD_ID = IDS["field:std_company.quotes"];

export default defineField({
  universalIdentifier: FIELD_ID,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
  type: FieldType.RELATION,
  name: "quotes",
  label: "报价单",
  icon: 'IconRelationManyToMany',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: OBJECT_UI["quote"],
  relationTargetFieldMetadataUniversalIdentifier: IDS["field:quote.company"],
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
