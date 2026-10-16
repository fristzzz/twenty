import { defineObject, FieldType } from 'twenty-sdk/define';
import { IDS, OBJECT_UI } from '../ids';

export const CONTRACTITEM_UI = OBJECT_UI["contractItem"];

export default defineObject({
  universalIdentifier: CONTRACTITEM_UI,
  nameSingular: "tapdataContractItem",
  namePlural: "tapdataContractItems",
  labelSingular: "合同行",
  labelPlural: "合同行",
  description: "Spike 建模：合同行",
  icon: "IconList",
  labelIdentifierFieldMetadataUniversalIdentifier: IDS["field:contractItem.description"],
  fields: [
    {
      universalIdentifier: IDS["field:contractItem.description"],
      type: FieldType.TEXT,
      name: "description",
      label: "描述",
      icon: "IconAbc",
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier: IDS["field:contractItem.quantity"],
      type: FieldType.NUMBER,
      name: "quantity",
      label: "数量",
      icon: "IconNumber123",
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier: IDS["field:contractItem.unitPrice"],
      type: FieldType.CURRENCY,
      name: "unitPrice",
      label: "单价",
      icon: "IconCoins",
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier: IDS["field:contractItem.totalAmount"],
      type: FieldType.CURRENCY,
      name: "totalAmount",
      label: "行金额",
      icon: "IconCoins",
      isNullable: true,
      defaultValue: null,
    },
  ],
});
