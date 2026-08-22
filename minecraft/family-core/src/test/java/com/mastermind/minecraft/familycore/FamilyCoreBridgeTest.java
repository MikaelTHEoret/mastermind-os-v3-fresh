package com.mastermind.minecraft.familycore;

import com.google.gson.JsonObject;
import com.mastermind.minecraft.familycore.bridge.FamilyCoreCodec;
import com.mastermind.minecraft.familycore.bridge.ServerBridgeConfig;
import com.mastermind.minecraft.familycore.telemetry.FamilyCoreRuntimeConfig;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class FamilyCoreBridgeTest {
    @TempDir
    Path temporaryDirectory;

    @Test
    void bridgeAndComputerCommandRemainDisabledWithoutPrivateConfiguration() {
        FamilyCoreRuntimeConfig config = FamilyCoreRuntimeConfig.fromProperties(new Properties());
        assertFalse(config.serverBridge().enabled());
        assertFalse(config.computerCommandEnabled());
        assertFalse(config.identityEventsEnabled());
        assertFalse(FamilyCoreFeatures.flags(config).get("serverBridge"));
        assertFalse(FamilyCoreFeatures.flags(config).get("computerCommand"));
    }

    @Test
    void identityEventsRequireTheAuthenticatedBridgeAndActivateIndependently() throws Exception {
        Properties unsafe = new Properties();
        unsafe.setProperty("identityEvents.enabled", "true");
        assertThrows(IllegalArgumentException.class, () -> FamilyCoreRuntimeConfig.fromProperties(unsafe));

        Path token = temporaryDirectory.resolve("family-core-identity.token");
        Files.writeString(token, "abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789");
        Properties properties = bridgeProperties(token);
        properties.setProperty("identityEvents.enabled", "true");
        FamilyCoreRuntimeConfig config = FamilyCoreRuntimeConfig.fromProperties(properties);
        assertTrue(config.identityEventsEnabled());
        assertTrue(FamilyCoreFeatures.flags(config).get("identityEvents"));
        assertFalse(config.computerCommandEnabled());
    }

    @Test
    void computerCommandCannotBeEnabledWithoutTheAuthenticatedBridge() {
        Properties properties = new Properties();
        properties.setProperty("computerCommand.enabled", "true");
        assertThrows(IllegalArgumentException.class, () -> FamilyCoreRuntimeConfig.fromProperties(properties));
    }

    @Test
    void bridgeConfigurationPinsLoopbackEndpointAndRedactsItsToken() throws Exception {
        Path token = temporaryDirectory.resolve("family-core.token");
        Files.writeString(token, "abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789");
        Properties properties = bridgeProperties(token);
        FamilyCoreRuntimeConfig config = FamilyCoreRuntimeConfig.fromProperties(properties);
        assertTrue(config.serverBridge().enabled());
        assertEquals("Bearer abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789", config.serverBridge().authorizationHeader());
        assertFalse(config.serverBridge().toString().contains("abcdefghijklmnopqrstuvwxyz"));

        properties.setProperty("serverBridge.endpoint", "ws://0.0.0.0:43100/v1/family-core/bridge");
        assertThrows(IllegalArgumentException.class, () -> FamilyCoreRuntimeConfig.fromProperties(properties));
    }

    @Test
    void controlCodecEnforcesExactFieldsSessionAndContiguousSequence() {
        UUID sessionId = UUID.randomUUID();
        UUID messageId = UUID.randomUUID();
        UUID playerId = UUID.randomUUID();
        String valid = controlEnvelope(sessionId, messageId, 1,
            "computer.private", "{\"minecraftUuid\":\"" + playerId + "\",\"text\":\"Hello\"}");
        FamilyCoreCodec codec = new FamilyCoreCodec();
        FamilyCoreCodec.ControlFrame frame = codec.decodeControl(valid, sessionId, 0);
        assertEquals("computer.private", frame.type());
        assertEquals(1, frame.sequence());

        assertThrows(IllegalArgumentException.class, () -> codec.decodeControl(valid, UUID.randomUUID(), 0));
        assertThrows(IllegalArgumentException.class, () -> codec.decodeControl(valid, sessionId, 1));
        assertThrows(IllegalArgumentException.class, () -> codec.decodeControl(
            valid.replace("\"payload\":", "\"extra\":true,\"payload\":"), sessionId, 0
        ));
        assertThrows(IllegalArgumentException.class, () -> codec.decodeControl(
            valid.replace("\"version\":1", "\"version\":1,\"version\":1"), sessionId, 0
        ));
    }

    @Test
    void codecRejectsPrivilegedControlTypesThatThisBuildDoesNotAdvertise() {
        UUID sessionId = UUID.randomUUID();
        String admin = controlEnvelope(sessionId, UUID.randomUUID(), 1, "admin.execute",
            "{\"operationId\":\"" + UUID.randomUUID() + "\",\"operation\":\"status.query\","
                + "\"arguments\":{},\"approvalDigest\":\"" + "a".repeat(64) + "\"}");
        assertThrows(IllegalArgumentException.class, () -> new FamilyCoreCodec().decodeControl(admin, sessionId, 0));
    }

    @Test
    void serverFramesRemainBoundedAndUseThePinnedProtocol() {
        UUID sessionId = UUID.randomUUID();
        JsonObject heartbeat = new JsonObject();
        heartbeat.addProperty("uptimeMs", 1);
        heartbeat.addProperty("playerCount", 0);
        heartbeat.addProperty("lastControlSeq", 0);
        String encoded = new FamilyCoreCodec().encodeServer(sessionId, 1, "server.heartbeat", heartbeat, null);
        assertTrue(encoded.contains("\"protocol\":\"mastermind.family-core\""));
        assertTrue(encoded.contains("\"source\":\"family-core\""));
    }

    private Properties bridgeProperties(Path token) {
        Properties properties = new Properties();
        properties.setProperty("serverBridge.enabled", "true");
        properties.setProperty("serverBridge.endpoint", ServerBridgeConfig.ENDPOINT.toString());
        properties.setProperty("serverBridge.sessionId", UUID.randomUUID().toString());
        properties.setProperty("serverBridge.instanceId", UUID.randomUUID().toString());
        properties.setProperty("serverBridge.tokenFile", token.toAbsolutePath().toString());
        return properties;
    }

    private static String controlEnvelope(UUID sessionId, UUID messageId, int sequence, String type, String payload) {
        return "{"
            + "\"protocol\":\"mastermind.family-core\","
            + "\"version\":1,"
            + "\"messageId\":\"" + messageId + "\","
            + "\"sessionId\":\"" + sessionId + "\","
            + "\"seq\":" + sequence + ","
            + "\"sentAt\":\"2026-08-22T04:00:00.000Z\","
            + "\"source\":\"control-plane\","
            + "\"type\":\"" + type + "\","
            + "\"correlationId\":null,"
            + "\"payload\":" + payload
            + "}";
    }
}
