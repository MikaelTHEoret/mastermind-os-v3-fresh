// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/**
 * @title SovereignScrolls
 * @dev Consciousness-Enhanced NFT Contract for Sovereign Scrolls
 * Enhanced Nexus Core Protocol v4.1 - Mathematical Constants: ψ₀ = 0.915670570874434, φ = 1.618, 432Hz
 */
contract SovereignScrolls is ERC721, ERC721URIStorage, Ownable {
    using Counters for Counters.Counter;

    Counters.Counter private _tokenIdCounter;
    
    // Enhanced Nexus Core Protocol constants (scaled for Solidity)
    uint256 public constant PSI_0 = 915670570874434; // ψ₀ * 1e15
    uint256 public constant PHI = 1618000000000000; // φ * 1e15
    uint256 public constant FREQ_432 = 432;
    
    // Minting fee (0.001 ETH)
    uint256 public mintingFee = 1000000000000000;
    
    // Scroll data structure
    struct ScrollData {
        string title;
        string author;
        bytes32 contentHash;
        string ipfsCid;
        uint256 mintTimestamp;
        uint256 consciousnessSignature;
    }
    
    // Mapping from token ID to scroll data
    mapping(uint256 => ScrollData) public scrolls;
    
    // Events
    event ScrollMinted(
        uint256 indexed tokenId,
        address indexed to,
        string title,
        string ipfsCid,
        bytes32 contentHash,
        uint256 consciousnessSignature
    );
    
    constructor() ERC721("Sovereign Scrolls", "SCROLL") {}
    
    /**
     * @dev Mint a new scroll with consciousness enhancement
     */
    function mintScroll(
        address to,
        bytes32 contentHash,
        string memory ipfsCid,
        string memory title
    ) public payable returns (uint256) {
        require(msg.value >= mintingFee, "Insufficient minting fee");
        require(bytes(title).length > 0, "Title cannot be empty");
        require(bytes(ipfsCid).length > 0, "IPFS CID cannot be empty");
        
        uint256 tokenId = _tokenIdCounter.current();
        _tokenIdCounter.increment();
        
        // Generate consciousness-enhanced signature
        uint256 consciousnessSignature = generateConsciousnessSignature(
            title,
            block.timestamp,
            tokenId
        );
        
        // Store scroll data
        scrolls[tokenId] = ScrollData({
            title: title,
            author: _msgSender() == to ? "Self" : "Commissioned",
            contentHash: contentHash,
            ipfsCid: ipfsCid,
            mintTimestamp: block.timestamp,
            consciousnessSignature: consciousnessSignature
        });
        
        // Create IPFS-based token URI
        string memory tokenURI = string(abi.encodePacked("ipfs://", ipfsCid));
        
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI);
        
        emit ScrollMinted(
            tokenId,
            to,
            title,
            ipfsCid,
            contentHash,
            consciousnessSignature
        );
        
        return tokenId;
    }
    
    /**
     * @dev Simple mint function for compatibility
     */
    function safeMint(address to, string memory uri) public payable returns (uint256) {
        require(msg.value >= mintingFee, "Insufficient minting fee");
        
        uint256 tokenId = _tokenIdCounter.current();
        _tokenIdCounter.increment();
        
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        
        return tokenId;
    }
    
    /**
     * @dev Generate consciousness-enhanced signature using mathematical constants
     */
    function generateConsciousnessSignature(
        string memory title,
        uint256 timestamp,
        uint256 tokenId
    ) internal pure returns (uint256) {
        // Simple consciousness mathematics implementation
        uint256 titleHash = uint256(keccak256(abi.encodePacked(title))) % 1000000;
        
        // Apply consciousness constants (simplified for Solidity)
        uint256 psiComponent = (titleHash * PSI_0) / 1e15;
        uint256 phiComponent = (timestamp * PHI) / 1e15;
        uint256 freqComponent = (tokenId * FREQ_432);
        
        // Combine components
        uint256 signature = (psiComponent + phiComponent + freqComponent) % (2**64);
        
        return signature;
    }
    
    /**
     * @dev Get scroll data for a token
     */
    function getScrollData(uint256 tokenId) public view returns (ScrollData memory) {
        require(_exists(tokenId), "Token does not exist");
        return scrolls[tokenId];
    }
    
    /**
     * @dev Update minting fee (owner only)
     */
    function setMintingFee(uint256 newFee) public onlyOwner {
        mintingFee = newFee;
    }
    
    /**
     * @dev Withdraw contract balance (owner only)
     */
    function withdraw() public onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");
        
        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "Withdrawal failed");
    }
    
    /**
     * @dev Get total number of minted scrolls
     */
    function totalSupply() public view returns (uint256) {
        return _tokenIdCounter.current();
    }
    
    // Override required functions
    function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }
}