import {
  defineField,
  FieldType,
  RelationType,
} from 'twenty-sdk/define';
import { IDS, OBJECT_UI } from '../ids';

export default defineField({
  universalIdentifier: IDS["field:contract.receipts"],
  objectUniversalIdentifier: OBJECT_UI["contract"],
  type: FieldType.RELATION,
  name: "receipts",
  label: "回款明细",
  icon: 'IconCoins',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: OBJECT_UI["receipt"],
  relationTargetFieldMetadataUniversalIdentifier: IDS["field:receipt.contract"],
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
