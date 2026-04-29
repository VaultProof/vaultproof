targetScope = 'resourceGroup'

@description('Azure region for the enterprise secure runtime. Pick a region where DCasv5/DCesv5 Confidential VM SKUs are available in your subscription.')
param location string = resourceGroup().location

@description('Short environment name used in resource names.')
param environmentName string = 'vpent'

@description('Admin username for the Confidential VM.')
param adminUsername string = 'azureuser'

@secure()
@description('SSH public key for the Confidential VM admin user.')
param adminSshPublicKey string

@description('Confidential VM size. Use a DCasv5/DCesv5 Confidential VM SKU that is available in the selected region.')
param vmSize string = 'Standard_DC2as_v5'

@description('CIDR allowed to SSH to the VM during bootstrap. Lock this to your current IP; do not leave as 0.0.0.0/0.')
param sshSourceCidr string

@description('Allow public SSH bootstrap ingress on port 22. Keep true during initial setup; set false after the production path and alternate access are verified.')
param allowSshBootstrap bool = true

@description('CIDR allowed to call the private executor port. Use the control-plane subnet once private networking is enabled.')
param executorSourceCidr string = '10.42.1.0/24'

@description('Allow Azure Front Door traffic to the co-located enterprise control plane on port 3001.')
param allowFrontDoorToControlPlane bool = false

@description('Allow Azure Front Door traffic to the TLS origin proxy on port 443.')
param allowFrontDoorToTlsControlPlane bool = false

@description('Primary source service tag or CIDR for public control-plane ingress. Use AzureFrontDoor.Backend for Front Door cutover.')
param controlPlaneIngressSource string = 'AzureFrontDoor.Backend'

@description('Allow Azure API Management traffic to the co-located enterprise control plane on port 3001. Enable only when APIM is deployed and the control plane accepts the APIM origin-lock secret or forwarded Front Door ID.')
param allowApiManagementToControlPlane bool = false

@description('Primary source service tag or CIDR for API Management-to-control-plane ingress.')
param apiManagementIngressSource string = 'ApiManagement'

@description('Base64url-encoded Azure Key Vault Secure Key Release policy. Replace with the attestation policy after VM measurements are known.')
param secureKeyReleasePolicyData string = ''

@description('Create the prototype Key Vault release key. Keep false for the first VM deployment; enable only after a Secure Key Release policy exists.')
param deployPrototypeReleaseKey bool = false

@description('Deploy Azure Managed HSM for the final RSA-HSM Secure Key Release root. The executor derives the AES-256 unwrap key inside the Confidential VM.')
param deployManagedHsm bool = false

@description('Initial Managed HSM administrator object ID. Required when deployManagedHsm is true. Get it with: az ad signed-in-user show --query id -o tsv')
param managedHsmInitialAdminObjectId string = ''

@description('Deploy Azure API Management for enterprise API lifecycle governance.')
param deployApiManagement bool = false

@description('API Management publisher email.')
param apiManagementPublisherEmail string = 'security@vaultproof.dev'

@description('API Management publisher name.')
param apiManagementPublisherName string = 'VaultProof'

@allowed([
  'Developer'
  'BasicV2'
  'StandardV2'
  'PremiumV2'
])
@description('API Management SKU. Use StandardV2 for production starter or PremiumV2 for stronger networking/isolation.')
param apiManagementSkuName string = 'StandardV2'

@description('API Management capacity units.')
param apiManagementCapacity int = 1

@description('Backend URL APIM forwards to. Leave empty to use the Confidential VM public control-plane origin on port 3001.')
param apiManagementBackendUrl string = ''

@description('APIM API path prefix. The default exposes /enterprise/* on the APIM gateway.')
param apiManagementApiPath string = 'enterprise'

@description('Require APIM subscriptions for the VaultProof-managed enterprise API.')
param apiManagementSubscriptionRequired bool = false

@description('Per-minute APIM rate limit per subscription key or client IP.')
param apiManagementRateLimitCalls int = 120

@description('Daily APIM quota per subscription key or client IP.')
param apiManagementQuotaCalls int = 10000

@description('Maximum inbound request body size APIM should allow, in bytes.')
param apiManagementMaxRequestBodyBytes int = 1048576

@description('Non-secret caller-lock marker APIM forwards to the control plane.')
param apiManagementGatewayMarker string = 'vaultproof-managed'

@description('Hostname APIM forwards to the control plane through x-forwarded-host so the enterprise hostname guard accepts sidecar gateway traffic.')
param apiManagementForwardedHost string = 'enterprise.vaultproof.dev'

@description('Header name APIM uses when forwarding the custom origin-lock secret to the control plane.')
param apiManagementOriginLockHeaderName string = 'x-vaultproof-origin-lock'

@secure()
@description('Optional custom origin-lock secret APIM forwards to the control plane. Set the same value in ENTERPRISE_ORIGIN_LOCK_SECRET on the Confidential VM before requiring APIM-origin traffic.')
param apiManagementOriginLockSecret string = ''

@description('Enable APIM JWT validation before requests reach the VaultProof enterprise control plane. Requires apiManagementJwtOpenIdConfigUrl.')
param apiManagementJwtValidationEnabled bool = false

@description('OpenID Connect metadata URL used by APIM validate-jwt, such as https://login.microsoftonline.com/<tenant-id>/v2.0/.well-known/openid-configuration or another OpenID-compatible session provider metadata URL.')
param apiManagementJwtOpenIdConfigUrl string = ''

@description('Optional issuer APIM should require in inbound bearer tokens. Leave empty to rely on the OpenID metadata issuer.')
param apiManagementJwtIssuer string = ''

@description('Optional JWT audiences APIM should require in inbound bearer tokens.')
param apiManagementJwtAudiences array = []

@description('Deploy Azure Monitor resources for enterprise production readiness and VM availability alerting.')
param deployMonitoring bool = false

@description('Public enterprise URL monitored through Azure Front Door. Do not include a trailing slash.')
param monitoringEnterpriseUrl string = 'https://enterprise.vaultproof.dev'

@description('Email address for Azure Monitor action group notifications. Leave empty to create the action group without email receivers.')
param monitoringAlertEmail string = ''

@description('Webhook URL for Azure Monitor action group notifications. Leave empty to create the action group without webhook receivers.')
param monitoringWebhookUrl string = ''

@description('Application Insights availability test locations.')
param monitoringAvailabilityTestLocations array = [
  {
    Id: 'us-ca-sjc-azr'
  }
  {
    Id: 'us-va-ash-azr'
  }
  {
    Id: 'us-tx-sn1-azr'
  }
]

@description('How often Azure Monitor evaluates the availability and VM metric alerts.')
param monitoringEvaluationFrequency string = 'PT1M'

@description('Alert evaluation window.')
param monitoringWindowSize string = 'PT5M'

@description('Number of availability test locations that must fail before firing.')
param monitoringFailedLocationCount int = 2

var tags = {
  app: 'vaultproof'
  tier: 'enterprise'
  security: 'confidential'
}

var vnetName = '${environmentName}-vnet'
var executorSubnetName = 'executor'
var controlPlaneSubnetName = 'control-plane'
var nsgName = '${environmentName}-executor-nsg'
var nicName = '${environmentName}-executor-nic'
var pipName = '${environmentName}-executor-bootstrap-pip'
var vmName = '${environmentName}-executor-cvm'
var keyVaultName = take('${environmentName}${uniqueString(resourceGroup().id)}kv', 24)
var managedHsmName = take('${environmentName}${uniqueString(resourceGroup().id)}hsm', 24)
var unwrapKeyName = 'vaultproof-enterprise-unwrap'
var attestationName = take('${environmentName}${uniqueString(resourceGroup().id)}maa', 24)
var apiManagementName = take('${environmentName}${uniqueString(resourceGroup().id)}apim', 50)
var apiManagementResolvedBackendUrl = empty(apiManagementBackendUrl) ? 'http://${publicIp.properties.ipAddress}:3001' : apiManagementBackendUrl
var monitoringWorkspaceName = take('${environmentName}-${uniqueString(resourceGroup().id)}-logs', 63)
var monitoringAppInsightsName = take('${environmentName}-${uniqueString(resourceGroup().id)}-appi', 255)
var monitoringActionGroupName = take('${environmentName}-${uniqueString(resourceGroup().id)}-ops-ag', 260)
var monitoringHealthTestName = take('${environmentName}-${uniqueString(resourceGroup().id)}-health', 260)
var monitoringReadinessTestName = take('${environmentName}-${uniqueString(resourceGroup().id)}-readiness', 260)
var monitoringHealthAlertName = take('${environmentName}-${uniqueString(resourceGroup().id)}-health-alert', 260)
var monitoringReadinessAlertName = take('${environmentName}-${uniqueString(resourceGroup().id)}-readiness-alert', 260)
var monitoringVmAvailabilityAlertName = take('${environmentName}-${uniqueString(resourceGroup().id)}-vm-availability-alert', 260)
var monitoringAvailabilityActions = [
  {
    actionGroupId: monitoringActionGroup.id
  }
]
var createPrototypeReleaseKey = deployPrototypeReleaseKey && !empty(secureKeyReleasePolicyData)
var apiManagementJwtAudienceXmlParts = [for audience in apiManagementJwtAudiences: '<audience>${audience}</audience>']
var apiManagementJwtAudienceXml = join(apiManagementJwtAudienceXmlParts, '')
var apiManagementJwtAudiencesXml = empty(apiManagementJwtAudienceXml) ? '' : '<audiences>${apiManagementJwtAudienceXml}</audiences>'
var apiManagementJwtIssuersXml = empty(apiManagementJwtIssuer) ? '' : '<issuers><issuer>${apiManagementJwtIssuer}</issuer></issuers>'
var apiManagementJwtPolicyXml = apiManagementJwtValidationEnabled ? format('''
    <validate-jwt header-name="Authorization" failed-validation-httpcode="401" failed-validation-error-message="Unauthorized" require-scheme="Bearer">
      <openid-config url="{0}" />
      {1}
      {2}
    </validate-jwt>
''', apiManagementJwtOpenIdConfigUrl, apiManagementJwtAudiencesXml, apiManagementJwtIssuersXml) : ''
var enterpriseApiPolicyXml = format('''
<policies>
  <inbound>
    <base />
{6}
    <rate-limit-by-key calls="{0}" renewal-period="60" counter-key="@(context.Subscription?.Key ?? context.Request.IpAddress)" />
    <quota-by-key calls="{1}" renewal-period="86400" counter-key="@(context.Subscription?.Key ?? context.Request.IpAddress)" />
    <choose>
      <when condition='@(context.Request.Headers.ContainsKey("content-length") &amp;&amp; long.Parse(context.Request.Headers.GetValueOrDefault("content-length", "0")) &gt; {2})'>
        <return-response>
          <set-status code="413" reason="Payload Too Large" />
          <set-body>Request body is too large</set-body>
        </return-response>
      </when>
    </choose>
    <set-header name="x-vaultproof-apim" exists-action="override">
      <value>enterprise</value>
    </set-header>
    <set-header name="x-vaultproof-customer-gateway" exists-action="override">
      <value>{3}</value>
    </set-header>
    <set-header name="x-forwarded-host" exists-action="override">
      <value>{4}</value>
    </set-header>
    <set-header name="{5}" exists-action="override">
      <value>{{{{vaultproof-origin-lock-secret}}}}</value>
    </set-header>
    <set-header name="x-api-key" exists-action="delete" />
    <set-header name="openai-api-key" exists-action="delete" />
    <set-header name="anthropic-api-key" exists-action="delete" />
    <set-header name="stripe-api-key" exists-action="delete" />
    <set-backend-service base-url="{6}" />
  </inbound>
  <backend>
    <base />
  </backend>
  <outbound>
    <base />
  </outbound>
  <on-error>
    <base />
  </on-error>
</policies>
''', apiManagementRateLimitCalls, apiManagementQuotaCalls, apiManagementMaxRequestBodyBytes, apiManagementGatewayMarker, apiManagementForwardedHost, apiManagementOriginLockHeaderName, apiManagementResolvedBackendUrl, apiManagementJwtPolicyXml)

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: vnetName
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.42.0.0/16'
      ]
    }
    subnets: [
      {
        name: controlPlaneSubnetName
        properties: {
          addressPrefix: '10.42.1.0/24'
        }
      }
      {
        name: executorSubnetName
        properties: {
          addressPrefix: '10.42.2.0/24'
          networkSecurityGroup: {
            id: executorNsg.id
          }
        }
      }
    ]
  }
}

resource executorNsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: nsgName
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'AllowSshBootstrap'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: allowSshBootstrap ? 'Allow' : 'Deny'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '22'
          sourceAddressPrefix: sshSourceCidr
          destinationAddressPrefix: '*'
        }
      }
      {
        name: 'AllowPrivateExecutor'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '3002'
          sourceAddressPrefix: executorSourceCidr
          destinationAddressPrefix: '*'
        }
      }
      {
        name: 'AllowFrontDoorControlPlane'
        properties: {
          priority: 120
          direction: 'Inbound'
          access: allowFrontDoorToControlPlane ? 'Allow' : 'Deny'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '3001'
          sourceAddressPrefix: controlPlaneIngressSource
          destinationAddressPrefix: '*'
        }
      }
      {
        name: 'AllowFrontDoorTlsControlPlane'
        properties: {
          priority: 121
          direction: 'Inbound'
          access: allowFrontDoorToTlsControlPlane ? 'Allow' : 'Deny'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '443'
          sourceAddressPrefix: controlPlaneIngressSource
          destinationAddressPrefix: '*'
        }
      }
      {
        name: 'AllowFrontDoorFrontendControlPlane'
        properties: {
          priority: 122
          direction: 'Inbound'
          access: allowFrontDoorToControlPlane ? 'Allow' : 'Deny'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '3001'
          sourceAddressPrefix: 'AzureFrontDoor.Frontend'
          destinationAddressPrefix: '*'
        }
      }
      {
        name: 'AllowFrontDoorFrontendTlsControlPlane'
        properties: {
          priority: 123
          direction: 'Inbound'
          access: allowFrontDoorToTlsControlPlane ? 'Allow' : 'Deny'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '443'
          sourceAddressPrefix: 'AzureFrontDoor.Frontend'
          destinationAddressPrefix: '*'
        }
      }
      {
        name: 'AllowFrontDoorFirstPartyControlPlane'
        properties: {
          priority: 124
          direction: 'Inbound'
          access: allowFrontDoorToControlPlane ? 'Allow' : 'Deny'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '3001'
          sourceAddressPrefix: 'AzureFrontDoor.FirstParty'
          destinationAddressPrefix: '*'
        }
      }
      {
        name: 'AllowFrontDoorFirstPartyTlsControlPlane'
        properties: {
          priority: 125
          direction: 'Inbound'
          access: allowFrontDoorToTlsControlPlane ? 'Allow' : 'Deny'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '443'
          sourceAddressPrefix: 'AzureFrontDoor.FirstParty'
          destinationAddressPrefix: '*'
        }
      }
      {
        name: 'AllowApiManagementControlPlane'
        properties: {
          priority: 126
          direction: 'Inbound'
          access: allowApiManagementToControlPlane ? 'Allow' : 'Deny'
          protocol: 'Tcp'
          sourcePortRange: '*'
          destinationPortRange: '3001'
          sourceAddressPrefix: apiManagementIngressSource
          destinationAddressPrefix: '*'
        }
      }
      {
        name: 'DenyInboundInternet'
        properties: {
          priority: 4096
          direction: 'Inbound'
          access: 'Deny'
          protocol: '*'
          sourcePortRange: '*'
          destinationPortRange: '*'
          sourceAddressPrefix: 'Internet'
          destinationAddressPrefix: '*'
        }
      }
    ]
  }
}

resource publicIp 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: pipName
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
  }
}

resource executorNic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: nicName
  location: location
  tags: tags
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          privateIPAllocationMethod: 'Dynamic'
          subnet: {
            id: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, executorSubnetName)
          }
          publicIPAddress: {
            id: publicIp.id
          }
        }
      }
    ]
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'premium'
    }
    enablePurgeProtection: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enableRbacAuthorization: true
    publicNetworkAccess: 'Enabled'
  }
}

resource managedHsm 'Microsoft.KeyVault/managedHSMs@2023-07-01' = if (deployManagedHsm) {
  name: managedHsmName
  location: location
  tags: union(tags, {
    role: 'production-skr'
  })
  sku: {
    family: 'B'
    name: 'Standard_B1'
  }
  properties: {
    createMode: 'default'
    enablePurgeProtection: true
    enableSoftDelete: true
    initialAdminObjectIds: [
      managedHsmInitialAdminObjectId
    ]
    publicNetworkAccess: 'Enabled'
    softDeleteRetentionInDays: 90
    tenantId: tenant().tenantId
  }
}

resource unwrapKey 'Microsoft.KeyVault/vaults/keys@2023-07-01' = if (createPrototypeReleaseKey) {
  parent: keyVault
  name: unwrapKeyName
  properties: {
    kty: 'RSA-HSM'
    keySize: 3072
    keyOps: [
      'wrapKey'
      'unwrapKey'
      'release'
    ]
    attributes: {
      enabled: true
      exportable: true
    }
    release_policy: {
      contentType: 'application/json; charset=utf-8'
      data: secureKeyReleasePolicyData
    }
  }
}

resource attestation 'Microsoft.Attestation/attestationProviders@2021-06-01' = {
  name: attestationName
  location: location
  tags: tags
  properties: {
    publicNetworkAccess: 'Enabled'
    tpmAttestationAuthentication: 'Enabled'
  }
}

resource apiManagement 'Microsoft.ApiManagement/service@2024-05-01' = if (deployApiManagement) {
  name: apiManagementName
  location: location
  tags: union(tags, {
    role: 'api-lifecycle-governance'
  })
  sku: {
    name: apiManagementSkuName
    capacity: apiManagementCapacity
  }
  properties: {
    publisherEmail: apiManagementPublisherEmail
    publisherName: apiManagementPublisherName
  }
}

resource enterpriseApi 'Microsoft.ApiManagement/service/apis@2024-05-01' = if (deployApiManagement) {
  parent: apiManagement
  name: 'vaultproof-enterprise'
  properties: {
    displayName: 'VaultProof Enterprise API'
    path: apiManagementApiPath
    protocols: [
      'https'
    ]
    serviceUrl: apiManagementResolvedBackendUrl
    subscriptionRequired: apiManagementSubscriptionRequired
  }
}

resource apiManagementOriginLockNamedValue 'Microsoft.ApiManagement/service/namedValues@2024-05-01' = if (deployApiManagement) {
  parent: apiManagement
  name: 'vaultproof-origin-lock-secret'
  properties: {
    displayName: 'vaultproof-origin-lock-secret'
    secret: true
    value: apiManagementOriginLockSecret
  }
}

resource enterpriseHealthOperation 'Microsoft.ApiManagement/service/apis/operations@2024-05-01' = if (deployApiManagement) {
  parent: enterpriseApi
  name: 'health'
  properties: {
    displayName: 'Health'
    method: 'GET'
    urlTemplate: '/health'
    responses: [
      {
        statusCode: 200
        description: 'Control-plane health response.'
      }
    ]
  }
}

resource enterpriseReadinessOperation 'Microsoft.ApiManagement/service/apis/operations@2024-05-01' = if (deployApiManagement) {
  parent: enterpriseApi
  name: 'readiness'
  properties: {
    displayName: 'Readiness'
    method: 'GET'
    urlTemplate: '/readiness'
    responses: [
      {
        statusCode: 200
        description: 'End-to-end production readiness response.'
      }
    ]
  }
}

resource enterpriseExecuteOperation 'Microsoft.ApiManagement/service/apis/operations@2024-05-01' = if (deployApiManagement) {
  parent: enterpriseApi
  name: 'execute'
  properties: {
    displayName: 'Legacy Execute'
    method: 'POST'
    urlTemplate: '/execute'
    responses: [
      {
        statusCode: 200
        description: 'Secure execution response.'
      }
    ]
  }
}

resource enterpriseApiProxyOperation 'Microsoft.ApiManagement/service/apis/operations@2024-05-01' = if (deployApiManagement) {
  parent: enterpriseApi
  name: 'enterprise-api-proxy'
  properties: {
    displayName: 'Enterprise API Proxy'
    method: '*'
    urlTemplate: '/api/v1/enterprise/{*path}'
    templateParameters: [
      {
        name: 'path'
        type: 'string'
        required: false
        description: 'Enterprise API path after /api/v1/enterprise.'
      }
    ]
    responses: [
      {
        statusCode: 200
        description: 'Enterprise API response.'
      }
    ]
  }
}

resource enterpriseApiPolicy 'Microsoft.ApiManagement/service/apis/policies@2024-05-01' = if (deployApiManagement) {
  parent: enterpriseApi
  name: 'policy'
  dependsOn: [
    apiManagementOriginLockNamedValue
  ]
  properties: {
    format: 'rawxml'
    value: enterpriseApiPolicyXml
  }
}

resource apiManagementAppInsightsLogger 'Microsoft.ApiManagement/service/loggers@2024-05-01' = if (deployApiManagement && deployMonitoring) {
  parent: apiManagement
  name: 'vaultproof-appinsights'
  properties: {
    loggerType: 'applicationInsights'
    description: 'Application Insights logger for VaultProof enterprise APIM gateway errors and correlation.'
    resourceId: monitoringAppInsights!.id
    credentials: {
      instrumentationKey: monitoringAppInsights!.properties.InstrumentationKey
    }
  }
}

resource enterpriseApiDiagnostic 'Microsoft.ApiManagement/service/apis/diagnostics@2024-05-01' = if (deployApiManagement && deployMonitoring) {
  parent: enterpriseApi
  name: 'applicationinsights'
  properties: {
    alwaysLog: 'allErrors'
    httpCorrelationProtocol: 'W3C'
    loggerId: apiManagementAppInsightsLogger.id
    sampling: {
      samplingType: 'fixed'
      percentage: 100
    }
    verbosity: 'information'
  }
}

resource monitoringWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (deployMonitoring) {
  name: monitoringWorkspaceName
  location: location
  tags: union(tags, {
    role: 'production-monitoring'
  })
  properties: {
    retentionInDays: 30
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource monitoringAppInsights 'Microsoft.Insights/components@2020-02-02' = if (deployMonitoring) {
  name: monitoringAppInsightsName
  location: location
  kind: 'web'
  tags: union(tags, {
    role: 'availability-tests'
  })
  properties: {
    Application_Type: 'web'
    RetentionInDays: 90
    SamplingPercentage: 100
    WorkspaceResourceId: monitoringWorkspace.id
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource monitoringActionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = if (deployMonitoring) {
  name: monitoringActionGroupName
  location: 'global'
  tags: tags
  properties: {
    enabled: true
    groupShortName: 'vpentops'
    emailReceivers: empty(monitoringAlertEmail) ? [] : [
      {
        name: 'vaultproof-ops-email'
        emailAddress: monitoringAlertEmail
        useCommonAlertSchema: true
      }
    ]
    webhookReceivers: empty(monitoringWebhookUrl) ? [] : [
      {
        name: 'vaultproof-ops-webhook'
        serviceUri: monitoringWebhookUrl
        useCommonAlertSchema: true
      }
    ]
    armRoleReceivers: []
    automationRunbookReceivers: []
    azureAppPushReceivers: []
    azureFunctionReceivers: []
    eventHubReceivers: []
    itsmReceivers: []
    logicAppReceivers: []
    smsReceivers: []
    voiceReceivers: []
  }
}

resource monitoringHealthWebTest 'Microsoft.Insights/webtests@2022-06-15' = if (deployMonitoring) {
  name: monitoringHealthTestName
  location: location
  kind: 'standard'
  tags: union(tags, {
    'hidden-link:${monitoringAppInsights.id}': 'Resource'
  })
  properties: {
    Description: 'VaultProof enterprise Front Door health availability test.'
    Enabled: true
    Frequency: 300
    Kind: 'standard'
    Locations: monitoringAvailabilityTestLocations
    Name: monitoringHealthTestName
    Request: {
      FollowRedirects: true
      HttpVerb: 'GET'
      ParseDependentRequests: false
      RequestUrl: '${monitoringEnterpriseUrl}/health'
    }
    RetryEnabled: true
    SyntheticMonitorId: monitoringHealthTestName
    Timeout: 30
    ValidationRules: {
      ContentValidation: {
        ContentMatch: '"status":"ok"'
        IgnoreCase: false
        PassIfTextFound: true
      }
      ExpectedHttpStatusCode: 200
      IgnoreHttpStatusCode: false
      SSLCheck: true
    }
  }
}

resource monitoringReadinessWebTest 'Microsoft.Insights/webtests@2022-06-15' = if (deployMonitoring) {
  name: monitoringReadinessTestName
  location: location
  kind: 'standard'
  tags: union(tags, {
    'hidden-link:${monitoringAppInsights.id}': 'Resource'
  })
  properties: {
    Description: 'VaultProof enterprise production readiness drift test.'
    Enabled: true
    Frequency: 300
    Kind: 'standard'
    Locations: monitoringAvailabilityTestLocations
    Name: monitoringReadinessTestName
    Request: {
      FollowRedirects: true
      HttpVerb: 'GET'
      ParseDependentRequests: false
      RequestUrl: '${monitoringEnterpriseUrl}/readiness'
    }
    RetryEnabled: true
    SyntheticMonitorId: monitoringReadinessTestName
    Timeout: 30
    ValidationRules: {
      ContentValidation: {
        ContentMatch: '"production_ready":true'
        IgnoreCase: false
        PassIfTextFound: true
      }
      ExpectedHttpStatusCode: 200
      IgnoreHttpStatusCode: false
      SSLCheck: true
    }
  }
}

resource monitoringHealthAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (deployMonitoring) {
  name: monitoringHealthAlertName
  location: 'global'
  tags: union(tags, {
    'hidden-link:${monitoringAppInsights.id}': 'Resource'
    'hidden-link:${monitoringHealthWebTest.id}': 'Resource'
  })
  properties: {
    description: 'VaultProof enterprise /health availability failed from multiple Azure Monitor locations.'
    severity: 1
    enabled: true
    scopes: [
      monitoringHealthWebTest.id
      monitoringAppInsights.id
    ]
    evaluationFrequency: monitoringEvaluationFrequency
    windowSize: monitoringWindowSize
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria'
      webTestId: monitoringHealthWebTest.id
      componentId: monitoringAppInsights.id
      failedLocationCount: monitoringFailedLocationCount
    }
    actions: monitoringAvailabilityActions
  }
}

resource monitoringReadinessAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (deployMonitoring) {
  name: monitoringReadinessAlertName
  location: 'global'
  tags: union(tags, {
    'hidden-link:${monitoringAppInsights.id}': 'Resource'
    'hidden-link:${monitoringReadinessWebTest.id}': 'Resource'
  })
  properties: {
    description: 'VaultProof enterprise production readiness drifted away from production_ready=true.'
    severity: 0
    enabled: true
    scopes: [
      monitoringReadinessWebTest.id
      monitoringAppInsights.id
    ]
    evaluationFrequency: monitoringEvaluationFrequency
    windowSize: monitoringWindowSize
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria'
      webTestId: monitoringReadinessWebTest.id
      componentId: monitoringAppInsights.id
      failedLocationCount: monitoringFailedLocationCount
    }
    actions: monitoringAvailabilityActions
  }
}

resource monitoringVmAvailabilityAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (deployMonitoring) {
  name: monitoringVmAvailabilityAlertName
  location: 'global'
  tags: tags
  properties: {
    description: 'VaultProof enterprise Confidential VM availability dropped below healthy.'
    severity: 1
    enabled: true
    scopes: [
      confidentialVm.id
    ]
    evaluationFrequency: monitoringEvaluationFrequency
    windowSize: monitoringWindowSize
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'vmAvailability'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'VmAvailabilityMetric'
          metricNamespace: 'Microsoft.Compute/virtualMachines'
          operator: 'LessThan'
          threshold: 1
          timeAggregation: 'Average'
          skipMetricValidation: true
          dimensions: []
        }
      ]
    }
    actions: monitoringAvailabilityActions
  }
}

resource confidentialVm 'Microsoft.Compute/virtualMachines@2023-09-01' = {
  name: vmName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    hardwareProfile: {
      vmSize: vmSize
    }
    osProfile: {
      computerName: vmName
      adminUsername: adminUsername
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: adminSshPublicKey
            }
          ]
        }
      }
    }
    securityProfile: {
      securityType: 'ConfidentialVM'
      uefiSettings: {
        secureBootEnabled: true
        vTpmEnabled: true
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: '0001-com-ubuntu-confidential-vm-jammy'
        sku: '22_04-lts-cvm'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        managedDisk: {
          storageAccountType: 'Premium_LRS'
          securityProfile: {
            securityEncryptionType: 'VMGuestStateOnly'
          }
        }
        deleteOption: 'Delete'
      }
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: executorNic.id
          properties: {
            primary: true
          }
        }
      ]
    }
  }
}

output confidentialVmName string = confidentialVm.name
output confidentialVmResourceId string = confidentialVm.id
output confidentialVmPrincipalId string = confidentialVm.identity.principalId
output confidentialVmPrivateIp string = executorNic.properties.ipConfigurations[0].properties.privateIPAddress
output confidentialVmPublicIp string = publicIp.properties.ipAddress
output executorSubnetId string = resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, executorSubnetName)
output controlPlaneSubnetId string = resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, controlPlaneSubnetName)
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
output managedHsmName string = deployManagedHsm ? managedHsm!.name : ''
output managedHsmUri string = deployManagedHsm ? 'https://${managedHsm!.name}.managedhsm.azure.net/' : ''
output unwrapKeyName string = createPrototypeReleaseKey ? unwrapKey!.name : ''
output unwrapKeyId string = createPrototypeReleaseKey ? unwrapKey!.properties.keyUriWithVersion : ''
output prototypeKeyReleaseUrl string = createPrototypeReleaseKey ? '${unwrapKey!.properties.keyUriWithVersion}/release' : ''
output attestationProviderName string = attestation.name
output attestationProviderUri string = attestation.properties.attestUri
output apiManagementName string = deployApiManagement ? apiManagement!.name : ''
output apiManagementGatewayUrl string = deployApiManagement ? apiManagement!.properties.gatewayUrl : ''
output apiManagementBackendUrl string = deployApiManagement ? apiManagementResolvedBackendUrl : ''
output apiManagementApiUrl string = deployApiManagement ? '${apiManagement!.properties.gatewayUrl}/${apiManagementApiPath}' : ''
output apiManagementAppInsightsLoggerName string = (deployApiManagement && deployMonitoring) ? apiManagementAppInsightsLogger!.name : ''
output apiManagementDiagnosticName string = (deployApiManagement && deployMonitoring) ? enterpriseApiDiagnostic!.name : ''
output monitoringWorkspaceName string = deployMonitoring ? monitoringWorkspace!.name : ''
output monitoringAppInsightsName string = deployMonitoring ? monitoringAppInsights!.name : ''
output monitoringActionGroupName string = deployMonitoring ? monitoringActionGroup!.name : ''
output monitoringHealthWebTestName string = deployMonitoring ? monitoringHealthWebTest!.name : ''
output monitoringReadinessWebTestName string = deployMonitoring ? monitoringReadinessWebTest!.name : ''
output monitoringHealthAlertName string = deployMonitoring ? monitoringHealthAlert!.name : ''
output monitoringReadinessAlertName string = deployMonitoring ? monitoringReadinessAlert!.name : ''
output monitoringVmAvailabilityAlertName string = deployMonitoring ? monitoringVmAvailabilityAlert!.name : ''
