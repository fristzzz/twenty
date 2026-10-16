import {
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'twenty-sdk/define';
import { IDS, OBJECT_UI } from '../ids';

export const FIELD_ID = IDS["field:std_company.contracts"];

export default defineField({
  universalIdentifier: FIELD_ID,
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.company.universalIdentifier,
  type: FieldType.RELATION,
  name: "contracts",
  label: "合同",
  icon: 'IconRelationManyToMany',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: OBJECT_UI["contract"],
  relationTargetFieldMetadataUniversalIdentifier: IDS["field:contract.company"],
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
