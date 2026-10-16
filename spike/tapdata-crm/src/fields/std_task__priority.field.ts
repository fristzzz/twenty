import {
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
  defineField,
  FieldType,
} from 'twenty-sdk/define';
import { IDS } from '../ids';

export default defineField({
  universalIdentifier: IDS["field:std_task.priority"],
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.task.universalIdentifier,
  type: FieldType.SELECT,
  name: "priority",
  label: "优先级",
  icon: 'IconFlag',
  options: [
    { id: IDS["option:taskPriority:0"], value: "HIGH", label: "高", position: 0, color: "red" },
    { id: IDS["option:taskPriority:1"], value: "NORMAL", label: "普通", position: 1, color: "blue" },
    { id: IDS["option:taskPriority:2"], value: "LOW", label: "低", position: 2, color: "gray" },
  ],
  isNullable: true,
  defaultValue: null,
});
