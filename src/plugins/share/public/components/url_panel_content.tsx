/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import React, { Component, ReactElement } from 'react';

import {
  EuiButton,
  EuiCopy,
  EuiFlexGroup,
  EuiSpacer,
  EuiFlexItem,
  EuiForm,
  EuiFormRow,
  EuiIconTip,
  EuiLoadingSpinner,
  EuiRadioGroup,
  EuiSwitch,
  EuiSwitchEvent,
} from '@elastic/eui';

import { format as formatUrl, parse as parseUrl } from 'url';

import { FormattedMessage, I18nProvider } from '@kbn/i18n/react';
import { HttpStart } from 'kibana/public';
import { i18n } from '@kbn/i18n';

import { shortenUrl } from '../lib/url_shortener';

interface Props {
  allowShortUrl: boolean;
  isEmbedded?: boolean;
  objectId?: string;
  objectType: string;
  shareableUrl?: string;
  basePath: string;
  post: HttpStart['post'];
}

export enum ExportUrlAsType {
  EXPORT_URL_AS_SAVED_OBJECT = 'savedObject',
  EXPORT_URL_AS_SNAPSHOT = 'snapshot',
}

interface State {
  exportUrlAs: ExportUrlAsType;
  useShortUrl: boolean;
  showTopNavMenu: boolean;
  showQueryInput: boolean;
  showDatePicker: boolean;
  showFilterBar: boolean;
  isCreatingShortUrl: boolean;
  url?: string;
  shortUrlErrorMsg?: string;
}

type UrlParams = Pick<
  State,
  'showTopNavMenu' | 'showQueryInput' | 'showDatePicker' | 'showFilterBar'
>;

export class UrlPanelContent extends Component<Props, State> {
  private mounted?: boolean;
  private shortUrlCache?: string;

  constructor(props: Props) {
    super(props);

    this.shortUrlCache = undefined;

    this.state = {
      exportUrlAs: ExportUrlAsType.EXPORT_URL_AS_SNAPSHOT,
      useShortUrl: false,
      showTopNavMenu: false,
      showQueryInput: false,
      showDatePicker: false,
      showFilterBar: true,
      isCreatingShortUrl: false,
      url: '',
    };
  }

  public componentWillUnmount() {
    window.removeEventListener('hashchange', this.resetUrl);

    this.mounted = false;
  }

  public componentDidMount() {
    this.mounted = true;
    this.setUrl();

    window.addEventListener('hashchange', this.resetUrl, false);
  }

  public render() {
    return (
      <I18nProvider>
        <EuiForm className="kbnShareContextMenu__finalPanel" data-test-subj="shareUrlForm">
          {this.renderExportAsRadioGroup()}

          {this.renderShortUrlSwitch()}
          {this.renderTopNavMenuSwitch()}
          {this.renderQueryInputSwitch()}
          {this.renderDatePickerSwitch()}
          {this.renderFilterBarSwitch()}

          <EuiSpacer size="m" />

          <EuiCopy textToCopy={this.state.url || ''} anchorClassName="eui-displayBlock">
            {(copy: () => void) => (
              <EuiButton
                fill
                fullWidth
                onClick={copy}
                disabled={this.state.isCreatingShortUrl || this.state.url === ''}
                data-share-url={this.state.url}
                data-test-subj="copyShareUrlButton"
                size="s"
              >
                {this.props.isEmbedded ? (
                  <FormattedMessage
                    id="share.urlPanel.copyIframeCodeButtonLabel"
                    defaultMessage="Copy iFrame code"
                  />
                ) : (
                  <FormattedMessage
                    id="share.urlPanel.copyLinkButtonLabel"
                    defaultMessage="Copy link"
                  />
                )}
              </EuiButton>
            )}
          </EuiCopy>
        </EuiForm>
      </I18nProvider>
    );
  }

  private isNotSaved = () => {
    return this.props.objectId === undefined || this.props.objectId === '';
  };

  private resetUrl = () => {
    if (this.mounted) {
      this.shortUrlCache = undefined;
      this.setState(
        {
          useShortUrl: false,
        },
        this.setUrl
      );
    }
  };

  private getSavedObjectUrl = () => {
    if (this.isNotSaved()) {
      return;
    }

    const url = this.getSnapshotUrl();

    const parsedUrl = parseUrl(url);
    if (!parsedUrl || !parsedUrl.hash) {
      return;
    }

    // Get the application route, after the hash, and remove the #.
    const parsedAppUrl = parseUrl(parsedUrl.hash.slice(1), true);

    let formattedUrl = formatUrl({
      protocol: parsedUrl.protocol,
      auth: parsedUrl.auth,
      host: parsedUrl.host,
      pathname: parsedUrl.pathname,
      hash: formatUrl({
        pathname: parsedAppUrl.pathname,
        query: {
          // Add global state to the URL so that the iframe doesn't just show the time range
          // default.
          _g: parsedAppUrl.query._g,
        },
      }),
    });
    if (this.props.isEmbedded) {
      formattedUrl = this.makeUrlEmbeddable(formattedUrl);
    }

    return formattedUrl;
  };

  private getSnapshotUrl = () => {
    let url = this.props.shareableUrl || window.location.href;
    if (this.props.isEmbedded) {
      url = this.makeUrlEmbeddable(url);
    }
    return url;
  };

  private getEmbedQueryParams = (): string => {
    return [
      ['&show-top-nav-menu=true', this.state.showTopNavMenu],
      ['&show-query-input=true', this.state.showQueryInput],
      ['&show-date-picker=true', this.state.showDatePicker],
      ['&hide-filter-bar=true', !this.state.showFilterBar], // Inverted to keep default behaviour for old links
    ].reduce(
      (accumulator, [queryParam, include]) => (include ? accumulator + queryParam : accumulator),
      '?embed=true'
    );
  };

  private makeUrlEmbeddable = (url: string): string => {
    const urlHasQueryString = url.indexOf('?') !== -1;
    const embedQueryParams = this.getEmbedQueryParams();
    if (urlHasQueryString) {
      return url.replace('?', `${embedQueryParams}&`);
    }
    return `${url}${embedQueryParams}`;
  };

  private makeIframeTag = (url?: string) => {
    if (!url) {
      return;
    }

    return `<iframe src="${url}" height="600" width="800"></iframe>`;
  };

  private setUrl = () => {
    let url;
    if (this.state.exportUrlAs === ExportUrlAsType.EXPORT_URL_AS_SAVED_OBJECT) {
      url = this.getSavedObjectUrl();
    } else if (this.state.useShortUrl) {
      url = this.shortUrlCache;
    } else {
      url = this.getSnapshotUrl();
    }

    if (this.props.isEmbedded) {
      url = this.makeIframeTag(url);
    }

    this.setState({ url });
  };

  private handleExportUrlAs = (optionId: string) => {
    this.setState(
      {
        exportUrlAs: optionId as ExportUrlAsType,
      },
      this.setUrl
    );
  };

  private handleShortUrlChange = async (evt: EuiSwitchEvent) => {
    const isChecked = evt.target.checked;

    if (!isChecked || this.shortUrlCache !== undefined) {
      this.setState({ useShortUrl: isChecked }, this.setUrl);
      return;
    }

    // "Use short URL" is checked but shortUrl has not been generated yet so one needs to be created.
    this.setState({
      isCreatingShortUrl: true,
      shortUrlErrorMsg: undefined,
    });

    try {
      const shortUrl = await shortenUrl(this.getSnapshotUrl(), {
        basePath: this.props.basePath,
        post: this.props.post,
      });
      if (this.mounted) {
        this.shortUrlCache = shortUrl;
        this.setState(
          {
            isCreatingShortUrl: false,
            useShortUrl: isChecked,
          },
          this.setUrl
        );
      }
    } catch (fetchError) {
      if (this.mounted) {
        this.shortUrlCache = undefined;
        this.setState(
          {
            useShortUrl: false,
            isCreatingShortUrl: false,
            shortUrlErrorMsg: i18n.translate('share.urlPanel.unableCreateShortUrlErrorMessage', {
              defaultMessage: 'Unable to create short URL. Error: {errorMessage}',
              values: {
                errorMessage: fetchError.message,
              },
            }),
          },
          this.setUrl
        );
      }
    }
  };

  private handleUrlParamChange = (param: keyof UrlParams) => (evt: EuiSwitchEvent): void => {
    const stateUpdate: Partial<UrlParams> = { [param]: evt.target.checked };
    this.setState(stateUpdate as State, this.setUrl);
  };

  private renderExportUrlAsOptions = () => {
    return [
      {
        id: ExportUrlAsType.EXPORT_URL_AS_SNAPSHOT,
        label: this.renderWithIconTip(
          <FormattedMessage id="share.urlPanel.snapshotLabel" defaultMessage="Snapshot" />,
          <FormattedMessage
            id="share.urlPanel.snapshotDescription"
            defaultMessage="Snapshot URLs encode the current state of the {objectType} in the URL itself.
            Edits to the saved {objectType} won't be visible via this URL."
            values={{ objectType: this.props.objectType }}
          />
        ),
        ['data-test-subj']: 'exportAsSnapshot',
      },
      {
        id: ExportUrlAsType.EXPORT_URL_AS_SAVED_OBJECT,
        disabled: this.isNotSaved(),
        label: this.renderWithIconTip(
          <FormattedMessage id="share.urlPanel.savedObjectLabel" defaultMessage="Saved object" />,
          <FormattedMessage
            id="share.urlPanel.savedObjectDescription"
            defaultMessage="You can share this URL with people to let them load the most recent saved version of this {objectType}."
            values={{ objectType: this.props.objectType }}
          />
        ),
        ['data-test-subj']: 'exportAsSavedObject',
      },
    ];
  };

  private renderWithIconTip = (child: React.ReactNode, tipContent: React.ReactNode) => {
    return (
      <EuiFlexGroup gutterSize="none" responsive={false}>
        <EuiFlexItem>{child}</EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiIconTip content={tipContent} position="bottom" />
        </EuiFlexItem>
      </EuiFlexGroup>
    );
  };

  private renderExportAsRadioGroup = () => {
    const generateLinkAsHelp = this.isNotSaved() ? (
      <FormattedMessage
        id="share.urlPanel.canNotShareAsSavedObjectHelpText"
        defaultMessage="Can't share as saved object until the {objectType} has been saved."
        values={{ objectType: this.props.objectType }}
      />
    ) : undefined;
    return (
      <EuiFormRow
        label={
          <FormattedMessage
            id="share.urlPanel.generateLinkAsLabel"
            defaultMessage="Generate the link as"
          />
        }
        helpText={generateLinkAsHelp}
      >
        <EuiRadioGroup
          options={this.renderExportUrlAsOptions()}
          idSelected={this.state.exportUrlAs}
          onChange={this.handleExportUrlAs}
        />
      </EuiFormRow>
    );
  };

  private renderShortUrlSwitch = () => {
    if (
      this.state.exportUrlAs === ExportUrlAsType.EXPORT_URL_AS_SAVED_OBJECT ||
      !this.props.allowShortUrl
    ) {
      return;
    }
    const shortUrlLabel = (
      <FormattedMessage id="share.urlPanel.shortUrlLabel" defaultMessage="Short URL" />
    );
    const switchLabel = this.state.isCreatingShortUrl ? (
      <span>
        <EuiLoadingSpinner size="s" /> {shortUrlLabel}
      </span>
    ) : (
      shortUrlLabel
    );
    const switchComponent = (
      <EuiSwitch
        label={switchLabel}
        checked={this.state.useShortUrl}
        onChange={this.handleShortUrlChange}
        data-test-subj="useShortUrl"
      />
    );
    const tipContent = (
      <FormattedMessage
        id="share.urlPanel.shortUrlHelpText"
        defaultMessage="We recommend sharing shortened snapshot URLs for maximum compatibility.
        Internet Explorer has URL length restrictions,
        and some wiki and markup parsers don't do well with the full-length version of the snapshot URL,
        but the short URL should work great."
      />
    );

    return (
      <EuiFormRow helpText={this.state.shortUrlErrorMsg} data-test-subj="createShortUrl">
        {this.renderWithIconTip(switchComponent, tipContent)}
      </EuiFormRow>
    );
  };

  private renderTopNavMenuSwitch = (): ReactElement | void => {
    if (!this.props.isEmbedded) {
      return;
    }
    const switchLabel = (
      <FormattedMessage id="share.urlPanel.topNavMenuLabel" defaultMessage="Show top nav menu" />
    );
    const switchComponent = (
      <EuiSwitch
        label={switchLabel}
        checked={this.state.showTopNavMenu}
        onChange={this.handleUrlParamChange('showTopNavMenu')}
        data-test-subj="topNavMenuSwitch"
      />
    );
    const tipContent = (
      <FormattedMessage
        id="share.urlPanel.topNavMenuHelpText"
        defaultMessage="Display the top nav menu UI"
      />
    );

    return (
      <EuiFormRow data-test-subj="showTopNavMenu">
        {this.renderWithIconTip(switchComponent, tipContent)}
      </EuiFormRow>
    );
  };

  private renderQueryInputSwitch = (): ReactElement | void => {
    if (!this.props.isEmbedded) {
      return;
    }
    const switchLabel = (
      <FormattedMessage id="share.urlPanel.queryInputLabel" defaultMessage="Show query input" />
    );
    const switchComponent = (
      <EuiSwitch
        label={switchLabel}
        checked={this.state.showQueryInput}
        onChange={this.handleUrlParamChange('showQueryInput')}
        data-test-subj="queryInputSwitch"
      />
    );
    const tipContent = (
      <FormattedMessage
        id="share.urlPanel.queryInputHelpText"
        defaultMessage="Display the query input UI"
      />
    );

    return (
      <EuiFormRow data-test-subj="showQueryInput">
        {this.renderWithIconTip(switchComponent, tipContent)}
      </EuiFormRow>
    );
  };

  private renderDatePickerSwitch = (): ReactElement | void => {
    if (!this.props.isEmbedded) {
      return;
    }
    const switchLabel = (
      <FormattedMessage id="share.urlPanel.datePickerLabel" defaultMessage="Show date picker" />
    );
    const switchComponent = (
      <EuiSwitch
        label={switchLabel}
        checked={this.state.showDatePicker}
        onChange={this.handleUrlParamChange('showDatePicker')}
        data-test-subj="datePickerSwitch"
      />
    );
    const tipContent = (
      <FormattedMessage
        id="share.urlPanel.datePickerHelpText"
        defaultMessage="Display the date picker UI"
      />
    );

    return (
      <EuiFormRow data-test-subj="showDatePicker">
        {this.renderWithIconTip(switchComponent, tipContent)}
      </EuiFormRow>
    );
  };

  private renderFilterBarSwitch = (): ReactElement | void => {
    if (!this.props.isEmbedded) {
      return;
    }
    const switchLabel = (
      <FormattedMessage id="share.urlPanel.filterBarLabel" defaultMessage="Show filter bar" />
    );
    const switchComponent = (
      <EuiSwitch
        label={switchLabel}
        checked={this.state.showFilterBar}
        onChange={this.handleUrlParamChange('showFilterBar')}
        data-test-subj="filterBarSwitch"
      />
    );
    const tipContent = (
      <FormattedMessage
        id="share.urlPanel.filterBarHelpText"
        defaultMessage="Display the filter bar UI"
      />
    );

    return (
      <EuiFormRow data-test-subj="showFilterBar">
        {this.renderWithIconTip(switchComponent, tipContent)}
      </EuiFormRow>
    );
  };
}
