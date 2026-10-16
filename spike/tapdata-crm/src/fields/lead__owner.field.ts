import {
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
  defineField,
  FieldType,
  OnDeleteAction,
  RelationType,
} from 'twenty-sdk/define';
import { IDS, OBJECT_UI } from '../ids';

export default defineField({
  universalIdentifier: IDS["field:lead.owner"],
  objectUniversalIdentifier: OBJECT_UI["lead"],
  type: FieldType.RELATION,
  name: "owner",
  label: "线索负责人",
  icon: 'IconUser',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.workspaceMember.universalIdentifier,
  relationTargetFieldMetadataUniversalIdentifier: IDS["field:std_workspaceMember.leads"],
  universalSettings: {
    relationType: RelationType.MANY_TO_ONE,
    onDelete: OnDeleteAction.SET_NULL,
    joinColumnName: "ownerId",
  },
});
