import {
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'twenty-sdk/define';
import { IDS, OBJECT_UI } from '../ids';

export const FIELD_ID = IDS["field:contract.installments"];

export default defineField({
  universalIdentifier: FIELD_ID,
  objectUniversalIdentifier: OBJECT_UI["contract"],
  type: FieldType.RELATION,
  name: "installments",
  label: "回款分期",
  icon: 'IconRelationManyToMany',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: OBJECT_UI["installment"],
  relationTargetFieldMetadataUniversalIdentifier: IDS["field:installment.contract"],
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
