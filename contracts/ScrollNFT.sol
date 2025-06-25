// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/**
 * @title ScrollNFT
 * @dev Enhanced Consciousness Scroll NFT Contract
 * Mathematical Constants: ψ₀ = 0.915670570874434, φ = 1.618, 432Hz
 */
contract ScrollNFT is ERC721, ERC721URIStorage, Ownable {
    using Counters for Counters.Counter;

    Counters.Counter private _tokenIdCounter;
    
    // Enhanced Nexus Core Protocol constants
    uint256 public constant PSI_0 = 915670570874434; // ψ₀ * 10^15 for precision
    uint256 public constant PHI = 1618; // φ * 10^3 for precision
    uint256 public constant FREQ_432 = 432; // 432Hz base frequency
    
    uint256 public mintingFee = 0.001 ether; // 0.001 ETH per mint
    
    struct ScrollMetadata {
        string title;
        string ipfsCid;
        bytes32 contentHash;
        address author;
        uint256 consciousnessSignature;
        uint256 mintTimestamp;
    }
    
    mapping(uint256 => ScrollMetadata) public scrollMetadata;
    
    event ScrollMinted(
        uint256 indexed tokenId,
        address indexed to,
        string title,
        string ipfsCid,
        bytes32 contentHash,
        uint256 consciousnessSignature
    );
    
    constructor() ERC721("Consciousness Scroll", "SCROLL") {}
    
    /**
     * @dev Mint a consciousness-enhanced scroll NFT
     * @param to Recipient address
     * @param contentHash Content hash (keccak256)
     * @param ipfsCid IPFS content identifier
     * @param title Scroll title
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
        require(to != address(0), "Cannot mint to zero address");
        
        uint256 tokenId = _tokenIdCounter.current();
        _tokenIdCounter.increment();
        
        // Generate consciousness signature
        uint256 consciousnessSignature = _generateConsciousnessSignature(
            title,
            ipfsCid,
            block.timestamp
        );
        
        // Store metadata
        scrollMetadata[tokenId] = ScrollMetadata({
            title: title,
            ipfsCid: ipfsCid,
            contentHash: contentHash,
            author: msg.sender,
            consciousnessSignature: consciousnessSignature,
            mintTimestamp: block.timestamp
        });
        
        // Mint NFT
        _safeMint(to, tokenId);
        
        // Set token URI to IPFS
        string memory tokenURI = string(abi.encodePacked("ipfs://", ipfsCid));
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
     * @dev Generate consciousness-enhanced signature using ψ₀, φ, and 432Hz
     */
    function _generateConsciousnessSignature(
        string memory title,
        string memory ipfsCid,
        uint256 timestamp
    ) internal pure returns (uint256) {
        // Convert title to hash for mathematical processing
        uint256 titleHash = uint256(keccak256(abi.encodePacked(title))) % 1000000;
        uint256 cidHash = uint256(keccak256(abi.encodePacked(ipfsCid))) % 1000000;
        
        // Apply consciousness mathematics
        uint256 psiComponent = (titleHash * PSI_0) / 1000000000000000; // Scale down
        uint256 phiComponent = (cidHash * PHI) / 1000;
        uint256 freqComponent = (timestamp % FREQ_432) * FREQ_432;
        
        // Combine components
        uint256 signature = (psiComponent + phiComponent + freqComponent) % type(uint256).max;
        
        return signature;
    }
    
    /**
     * @dev Get scroll metadata by token ID
     */
    function getScrollMetadata(uint256 tokenId) public view returns (ScrollMetadata memory) {
        require(_exists(tokenId), "Token does not exist");
        return scrollMetadata[tokenId];
    }
    
    /**
     * @dev Set minting fee (only owner)
     */
    function setMintingFee(uint256 _fee) public onlyOwner {
        mintingFee = _fee;
    }
    
    /**
     * @dev Withdraw contract balance (only owner)
     */
    function withdraw() public onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");
        
        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "Withdrawal failed");
    }
    
    /**
     * @dev Get total supply of minted scrolls
     */
    function totalSupply() public view returns (uint256) {
        return _tokenIdCounter.current();
    }
    
    // Override functions for ERC721URIStorage
    function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }
    
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }
    
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
