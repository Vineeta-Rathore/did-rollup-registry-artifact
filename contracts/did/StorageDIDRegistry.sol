// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Storage-based DID registry: DID document material (owner, delegates,
/// attributes) is held in contract storage and read via view calls. This is
/// the design counterpoint to ERC-1056 (EthereumDIDRegistry), which carries
/// attribute data in events and reconstructs DID documents off-chain from
/// logs. Function surface mirrors ERC-1056 where the semantics allow, so the
/// per-operation gas comparison isolates the data-placement decision.
/// Events here signal state changes only and carry no document data; document
/// resolution requires no log scan.
contract StorageDIDRegistry {
    struct Attribute {
        bytes value;
        uint256 validTo;
    }

    mapping(address => address) public owners;
    mapping(address => bool) public registered;
    mapping(address => bool) public deactivated;
    mapping(address => mapping(bytes32 => mapping(address => uint256))) public delegates;
    mapping(address => mapping(bytes32 => Attribute)) private attributes;

    event Registered(address indexed identity, address owner);
    event OwnerChanged(address indexed identity, address newOwner);
    event Deactivated(address indexed identity);

    modifier onlyOwner(address identity) {
        require(msg.sender == identityOwner(identity), "bad_actor");
        require(!deactivated[identity], "deactivated");
        _;
    }

    function identityOwner(address identity) public view returns (address) {
        address o = owners[identity];
        return o == address(0) ? identity : o;
    }

    /// Explicit first-use registration: the storage design's analogue of
    /// ERC-1056's implicit (zero-cost) identity creation.
    function register(address identity) external {
        require(msg.sender == identityOwner(identity), "bad_actor");
        require(!registered[identity], "exists");
        registered[identity] = true;
        owners[identity] = msg.sender;
        emit Registered(identity, msg.sender);
    }

    function changeOwner(address identity, address newOwner) external onlyOwner(identity) {
        owners[identity] = newOwner;
        emit OwnerChanged(identity, newOwner);
    }

    function addDelegate(
        address identity,
        bytes32 delegateType,
        address delegate,
        uint256 validity
    ) external onlyOwner(identity) {
        delegates[identity][delegateType][delegate] = block.timestamp + validity;
    }

    function revokeDelegate(
        address identity,
        bytes32 delegateType,
        address delegate
    ) external onlyOwner(identity) {
        delegates[identity][delegateType][delegate] = block.timestamp;
    }

    function validDelegate(
        address identity,
        bytes32 delegateType,
        address delegate
    ) external view returns (bool) {
        return delegates[identity][delegateType][delegate] > block.timestamp;
    }

    function setAttribute(
        address identity,
        bytes32 name,
        bytes calldata value,
        uint256 validity
    ) external onlyOwner(identity) {
        attributes[identity][name] = Attribute(value, block.timestamp + validity);
    }

    function revokeAttribute(address identity, bytes32 name) external onlyOwner(identity) {
        delete attributes[identity][name];
    }

    function getAttribute(
        address identity,
        bytes32 name
    ) external view returns (bytes memory value, uint256 validTo) {
        Attribute storage a = attributes[identity][name];
        return (a.value, a.validTo);
    }

    function deactivate(address identity) external onlyOwner(identity) {
        deactivated[identity] = true;
        emit Deactivated(identity);
    }
}
