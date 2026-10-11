import { type Meta, type StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import { type ConnectedAccountVisibility } from 'twenty-shared/types';
import { ComponentDecorator } from 'twenty-ui/testing';

import { dispatchMetadataOperationBrowserEvent } from '@/browser-event/utils/dispatchMetadataOperationBrowserEvent';
import {
  APPLICATION_ID,
  buildApplicationConnectionHandlers,
} from '~/pages/settings/applications/__stories__/mockedApplicationConnections';
import { SettingsApplicationConnectionsSection } from '~/pages/settings/applications/tabs/SettingsApplicationConnectionsSection';
import { MemoryRouterDecorator } from '~/testing/decorators/MemoryRouterDecorator';
import { mockedApolloClient } from '~/testing/mockedApolloClient';

const meta: Meta<typeof SettingsApplicationConnectionsSection> = {
  title: 'Pages/Settings/Applications/SettingsApplicationConnectionsSection',
  component: SettingsApplicationConnectionsSection,
  args: { applicationId: APPLICATION_ID },
  decorators: [ComponentDecorator, MemoryRouterDecorator],
  beforeEach: async () => {
    await mockedApolloClient.clearStore();
  },
};

export default meta;
type Story = StoryObj<typeof SettingsApplicationConnectionsSection>;

export const WorkspaceConnections: Story = {
  parameters: {
    msw: {
      handlers: buildApplicationConnectionHandlers({
        allowedVisibilities: ['user', 'workspace'],
      }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    expect(
      await canvas.findByRole('link', { name: /Main calendar/ }),
    ).toBeVisible();
    expect(
      canvas.getByRole('button', { name: 'Add connection' }),
    ).toBeVisible();
  },
};

const updatedChoices: ConnectedAccountVisibility[] = ['user', 'workspace'];

export const RefreshesChoicesAfterAppUpdate: Story = {
  beforeEach: () => {
    updatedChoices.splice(0, updatedChoices.length, 'user', 'workspace');
  },
  parameters: {
    msw: {
      handlers: buildApplicationConnectionHandlers({
        allowedVisibilities: updatedChoices,
      }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    expect(
      await canvas.findByRole('button', { name: 'Add connection' }),
    ).toBeVisible();
    updatedChoices.splice(0, updatedChoices.length, 'user');
    dispatchMetadataOperationBrowserEvent({
      metadataName: 'application',
      operation: {
        type: 'update',
        updatedRecord: { id: APPLICATION_ID, version: '2.0.0' },
        updatedFields: ['version'],
      },
    });

    await waitFor(() => {
      expect(
        canvas.queryByRole('button', { name: 'Add connection' }),
      ).not.toBeInTheDocument();
      expect(canvas.getByRole('link', { name: /Main calendar/ })).toBeVisible();
    });
  },
};
