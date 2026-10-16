import { defineObject, FieldType } from 'twenty-sdk/define';
import { IDS, OBJECT_UI } from '../ids';

export const QUOTEITEM_UI = OBJECT_UI["quoteItem"];

export default defineObject({
  universalIdentifier: QUOTEITEM_UI,
  nameSingular: "tapdataQuoteItem",
  namePlural: "tapdataQuoteItems",
  labelSingular: "报价行",
  labelPlural: "报价行",
  description: "Spike 建模：报价行",
  icon: "IconList",
  labelIdentifierFieldMetadataUniversalIdentifier: IDS["field:quoteItem.description"],
  fields: [
    {
      universalIdentifier: IDS["field:quoteItem.description"],
      type: FieldType.TEXT,
      name: "description",
      label: "描述",
      icon: "IconAbc",
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier: IDS["field:quoteItem.quantity"],
      type: FieldType.NUMBER,
      name: "quantity",
      label: "数量",
      icon: "IconNumber123",
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier: IDS["field:quoteItem.listPrice"],
      type: FieldType.CURRENCY,
      name: "listPrice",
      label: "目录价",
      icon: "IconCoins",
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier: IDS["field:quoteItem.unitPrice"],
      type: FieldType.CURRENCY,
      name: "unitPrice",
      label: "成交单价",
      icon: "IconCoins",
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier: IDS["field:quoteItem.discountPercentage"],
      type: FieldType.NUMBER,
      name: "discountPercentage",
      label: "折扣(%)",
      icon: "IconNumber123",
      isNullable: true,
      defaultValue: null,
    },
    {
      universalIdentifier: IDS["field:quoteItem.totalAmount"],
      type: FieldType.CURRENCY,
      name: "totalAmount",
      label: "行金额",
      icon: "IconCoins",
      isNullable: true,
      defaultValue: null,
    },
  ],
});
