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

@description('CIDR allowed to call the private executor port. Use the control-plane subnet once private networking is enabled.')
param executorSourceCidr string = '10.42.1.0/24'

@description('Allow Azure Front Door traffic to the co-located enterprise control plane on port 3001.')
param allowFrontDoorToControlPlane bool = false

@description('Primary source service tag or CIDR for public control-plane ingress. Use AzureFrontDoor.Backend for Front Door cutover.')
param controlPlaneIngressSource string = 'AzureFrontDoor.Backend'

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
var createPrototypeReleaseKey = deployPrototypeReleaseKey && !empty(secureKeyReleasePolicyData)

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
          access: 'Allow'
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
    role: 'production-oct-hsm'
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
    path: 'enterprise'
    protocols: [
      'https'
    ]
    serviceUrl: 'https://enterprise.vaultproof.dev'
    apiVersion: 'v1'
    apiVersionSetId: null
    subscriptionRequired: false
  }
}

resource enterpriseApiPolicy 'Microsoft.ApiManagement/service/apis/policies@2024-05-01' = if (deployApiManagement) {
  parent: enterpriseApi
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: '''
<policies>
  <inbound>
    <base />
    <rate-limit-by-key calls="120" renewal-period="60" counter-key="@(context.Request.IpAddress)" />
    <quota-by-key calls="10000" renewal-period="86400" counter-key="@(context.Request.IpAddress)" />
    <set-header name="x-vaultproof-apim" exists-action="override">
      <value>enterprise</value>
    </set-header>
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
'''
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
