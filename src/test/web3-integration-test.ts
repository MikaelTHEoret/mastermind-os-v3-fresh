// 🌀 Web3 Integration Test
// Test the blockchain smart contract integration

import { ScrollMintingContract, scrollMinter } from '@/lib/web3/scroll-contracts';

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

export class Web3IntegrationTest {
  private results: TestResult[] = [];

  async runAllTests(): Promise<TestResult[]> {
    this.results = [];
    
    console.log('🧪 Running Web3 Integration Tests...');
    
    // Test 1: Address validation
    this.testAddressValidation();
    
    // Test 2: CID validation  
    this.testCIDValidation();
    
    // Test 3: Contract instantiation
    this.testContractInstantiation();
    
    // Test 4: ABI structure
    this.testABIStructure();
    
    return this.results;
  }

  private testAddressValidation(): void {
    try {
      // Valid addresses
      const validAddress1 = '0x4575a90d54785323546f2bb4a520622ed6d3efbc';
      const validAddress2 = '0x2C1f99011c584fDf4882Be484DfD938977D42C6D';
      
      // Invalid addresses
      const invalidAddress1 = '0x123'; // Too short
      const invalidAddress2 = '4575a90d54785323546f2bb4a520622ed6d3efbc'; // Missing 0x
      const invalidAddress3 = '0xZZZ5a90d54785323546f2bb4a520622ed6d3efbc'; // Invalid hex
      
      const test1 = ScrollMintingContract.isValidAddress(validAddress1);
      const test2 = ScrollMintingContract.isValidAddress(validAddress2);
      const test3 = !ScrollMintingContract.isValidAddress(invalidAddress1);
      const test4 = !ScrollMintingContract.isValidAddress(invalidAddress2);
      const test5 = !ScrollMintingContract.isValidAddress(invalidAddress3);
      
      const passed = test1 && test2 && test3 && test4 && test5;
      
      this.results.push({
        name: 'Address Validation',
        passed,
        message: passed ? 'All address validations passed' : 'Address validation failed'
      });
      
    } catch (error) {
      this.results.push({
        name: 'Address Validation',
        passed: false,
        message: `Error: ${error.message}`
      });
    }
  }

  private testCIDValidation(): void {
    try {
      // Valid CIDs
      const validCID1 = 'bafkreiabcd1234567890abcdef';
      const validCID2 = 'bafkreixyz9876543210fedcba';
      
      // Invalid CIDs
      const invalidCID1 = 'invalidcid';
      const invalidCID2 = 'bafkre'; // Too short
      const invalidCID3 = 'wrongprefix1234567890';
      
      const test1 = ScrollMintingContract.isValidCID(validCID1);
      const test2 = ScrollMintingContract.isValidCID(validCID2);
      const test3 = !ScrollMintingContract.isValidCID(invalidCID1);
      const test4 = !ScrollMintingContract.isValidCID(invalidCID2);
      const test5 = !ScrollMintingContract.isValidCID(invalidCID3);
      
      const passed = test1 && test2 && test3 && test4 && test5;
      
      this.results.push({
        name: 'CID Validation',
        passed,
        message: passed ? 'All CID validations passed' : 'CID validation failed'
      });
      
    } catch (error) {
      this.results.push({
        name: 'CID Validation',
        passed: false,
        message: `Error: ${error.message}`
      });
    }
  }

  private testContractInstantiation(): void {
    try {
      // Test if scrollMinter instance exists and has required methods
      const hasL1Method = typeof scrollMinter.mintOnL1 === 'function';
      const hasL2Method = typeof scrollMinter.mintOnL2 === 'function';
      const hasContractConfig = scrollMinter['contractConfig'] !== undefined;
      
      const passed = hasL1Method && hasL2Method && hasContractConfig;
      
      this.results.push({
        name: 'Contract Instantiation',
        passed,
        message: passed ? 'ScrollMinter instance created successfully' : 'ScrollMinter instantiation failed'
      });
      
    } catch (error) {
      this.results.push({
        name: 'Contract Instantiation',
        passed: false,
        message: `Error: ${error.message}`
      });
    }
  }

  private testABIStructure(): void {
    try {
      const abi = scrollMinter['getScrollABI']();
      const hasMintFunction = abi.some(item => 
        item.type === 'function' && 
        item.name === 'mintScroll'
      );
      
      const hasScrollMintedEvent = abi.some(item => 
        item.type === 'event' && 
        item.name === 'ScrollMinted'
      );
      
      const passed = hasMintFunction && hasScrollMintedEvent && abi.length > 0;
      
      this.results.push({
        name: 'ABI Structure',
        passed,
        message: passed ? 'ABI structure is valid' : 'ABI structure validation failed'
      });
      
    } catch (error) {
      this.results.push({
        name: 'ABI Structure',
        passed: false,
        message: `Error: ${error.message}`
      });
    }
  }

  printResults(): void {
    console.log('\n🧪 Web3 Integration Test Results:');
    console.log('================================');
    
    this.results.forEach(result => {
      const status = result.passed ? '✅' : '❌';
      console.log(`${status} ${result.name}: ${result.message}`);
    });
    
    const passedTests = this.results.filter(r => r.passed).length;
    const totalTests = this.results.length;
    
    console.log(`\n📊 Summary: ${passedTests}/${totalTests} tests passed`);
    
    if (passedTests === totalTests) {
      console.log('🎉 All tests passed! Web3 integration is ready.');
    } else {
      console.log('⚠️ Some tests failed. Please check the implementation.');
    }
  }
}

// Export for use in development
export const runWeb3Tests = async () => {
  const testRunner = new Web3IntegrationTest();
  const results = await testRunner.runAllTests();
  testRunner.printResults();
  return results;
};
