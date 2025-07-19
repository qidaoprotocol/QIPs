export interface IPFSHealth {
  apiAvailable: boolean;
  gatewayAvailable: boolean;
  version?: string;
  error?: string;
}

/**
 * Check the health of a local IPFS node
 */
export async function checkIPFSHealth(
  apiUrl: string = 'http://localhost:5001',
  gatewayUrl: string = 'http://localhost:8080'
): Promise<IPFSHealth> {
  try {
    // Check API availability and get version
    let apiAvailable = false;
    let version: string | undefined;
    
    try {
      const apiResponse = await fetch(`${apiUrl}/api/v0/version`, { 
        method: 'POST',
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
      apiAvailable = apiResponse.ok;
      if (apiAvailable) {
        const versionData = await apiResponse.json();
        version = versionData.Version;
      }
    } catch (error) {
      apiAvailable = false;
    }

    // Check Gateway availability using a known IPFS hash (empty directory)
    let gatewayAvailable = false;
    try {
      const gatewayResponse = await fetch(`${gatewayUrl}/ipfs/QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn`, {
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
      gatewayAvailable = gatewayResponse.ok;
    } catch (error) {
      gatewayAvailable = false;
    }

    return { 
      apiAvailable, 
      gatewayAvailable, 
      version 
    };
  } catch (error) {
    return { 
      apiAvailable: false, 
      gatewayAvailable: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Wait for IPFS to become available
 */
export async function waitForIPFS(
  apiUrl: string = 'http://localhost:5001',
  gatewayUrl: string = 'http://localhost:8080',
  maxRetries: number = 30,
  retryInterval: number = 1000
): Promise<IPFSHealth> {
  for (let i = 0; i < maxRetries; i++) {
    const health = await checkIPFSHealth(apiUrl, gatewayUrl);
    
    if (health.apiAvailable && health.gatewayAvailable) {
      return health;
    }
    
    if (i < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, retryInterval));
    }
  }
  
  // Final check to return the last status
  return await checkIPFSHealth(apiUrl, gatewayUrl);
}

/**
 * Test IPFS by uploading and retrieving content
 */
export async function testIPFSRoundTrip(
  apiUrl: string = 'http://localhost:5001',
  gatewayUrl: string = 'http://localhost:8080'
): Promise<{ success: boolean; cid?: string; error?: string }> {
  try {
    const testContent = `IPFS test content - ${Date.now()}`;
    
    // Upload test content
    const formData = new FormData();
    formData.append('file', new Blob([testContent], { type: 'text/plain' }));
    
    const uploadResponse = await fetch(`${apiUrl}/api/v0/add`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(10000)
    });
    
    if (!uploadResponse.ok) {
      return { success: false, error: `Upload failed: ${uploadResponse.statusText}` };
    }
    
    const uploadResult = await uploadResponse.json();
    const cid = uploadResult.Hash;
    
    // Retrieve content
    const retrieveResponse = await fetch(`${gatewayUrl}/ipfs/${cid}`, {
      signal: AbortSignal.timeout(10000)
    });
    
    if (!retrieveResponse.ok) {
      return { success: false, cid, error: `Retrieval failed: ${retrieveResponse.statusText}` };
    }
    
    const retrievedContent = await retrieveResponse.text();
    
    if (retrievedContent !== testContent) {
      return { success: false, cid, error: 'Content mismatch' };
    }
    
    return { success: true, cid };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}