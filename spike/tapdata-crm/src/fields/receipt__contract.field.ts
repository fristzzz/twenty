import {
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'twenty-sdk/define';
import { IDS, OBJECT_UI } from '../ids';

export default defineField({
  universalIdentifier: IDS["field:receipt.contract"],
  objectUniversalIdentifier: OBJECT_UI["receipt"],
  type: FieldType.RELATION,
  name: "contract",
  label: "关联销售合同",
  icon: 'IconFileInvoice',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: OBJECT_UI["contract"],
  relationTargetFieldMetadataUniversalIdentifier: IDS["field:contract.receipts"],
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.CASCADE,
    joinColumnName: "contractId",
  },
});
