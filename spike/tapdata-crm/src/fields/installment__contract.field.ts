import {
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'twenty-sdk/define';
import { IDS, OBJECT_UI } from '../ids';

export const FIELD_ID = IDS["field:installment.contract"];

export default defineField({
  universalIdentifier: FIELD_ID,
  objectUniversalIdentifier: OBJECT_UI["installment"],
  type: FieldType.RELATION,
  name: "contract",
  label: "所属合同",
  icon: 'IconRelationManyToMany',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: OBJECT_UI["contract"],
  relationTargetFieldMetadataUniversalIdentifier: IDS["field:contract.installments"],
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE,
    joinColumnName: "contractId",
  },
});
