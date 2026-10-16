import {
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
  defineField,
  FieldType,
  RelationType,
} from 'twenty-sdk/define';
import { IDS, OBJECT_UI } from '../ids';

export default defineField({
  universalIdentifier: IDS["field:std_workspaceMember.leads"],
  objectUniversalIdentifier: STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.workspaceMember.universalIdentifier,
  type: FieldType.RELATION,
  name: "leads",
  label: "负责线索",
  icon: 'IconTarget',
  isNullable: true,
  relationTargetObjectMetadataUniversalIdentifier: OBJECT_UI["lead"],
  relationTargetFieldMetadataUniversalIdentifier: IDS["field:lead.owner"],
  universalSettings: {
    relationType: RelationType.ONE_TO_MANY,
  },
});
