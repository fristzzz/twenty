import {
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'twenty-sdk/define';
import { IDS, OBJECT_UI } from '../ids';

export const FIELD_ID = IDS["field:quote.contracts"];

export default defineField({
  universalIdentifier: FIELD_ID,
  objectUniversalIdentifier: OBJECT_UI["quote"],
  type: FieldType.RELATION,
  name: "contracts",
  label: "关联合同",
  icon: 'IconRelationManyToMany',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: OBJECT_UI["contract"],
  relationTargetFieldMetadataUniversalIdentifier: IDS["field:contract.quote"],
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
