package com.mastermind.minecraft.familyagent.config;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

final class BridgeConfigTest {
    @Test
    void acceptsOnlyStrongEnvironmentTokenAndUsesFixedLoopbackEndpoint() {
        var token = "0123456789abcdef0123456789abcdef";
        var config = BridgeConfig.fromEnvironment(Map.of(
            BridgeConfig.TOKEN_ENV, token,
            BridgeConfig.FAMILY_SERVER_PORT_ENV, "25577"
        ));

        assertEquals("ws://127.0.0.1:43100/v1/companion/bridge", config.endpoint().toString());
        assertEquals("Bearer " + token, config.authorizationHeader());
        assertEquals(25577, config.familyServerPort());
        assertFalse(config.toString().contains(token));
    }

    @Test
    void requiresAnExactValidFamilyServerPort() {
        var token = "0123456789abcdef0123456789abcdef";
        assertThrows(IllegalStateException.class, () -> BridgeConfig.fromEnvironment(Map.of(BridgeConfig.TOKEN_ENV, token)));
        for (var port : new String[] { "0", "65536", "25565 ", "+25565", "01", "not-a-port" }) {
            assertThrows(IllegalStateException.class, () -> BridgeConfig.fromEnvironment(Map.of(
                BridgeConfig.TOKEN_ENV, token,
                BridgeConfig.FAMILY_SERVER_PORT_ENV, port
            )));
        }
    }

    @Test
    void rejectsMissingShortWhitespaceAndControlCharacterTokens() {
        assertThrows(IllegalStateException.class, () -> BridgeConfig.fromEnvironment(Map.of()));
        assertThrows(IllegalStateException.class, () -> BridgeConfig.fromEnvironment(Map.of(BridgeConfig.TOKEN_ENV, "short")));
        assertThrows(IllegalStateException.class, () -> BridgeConfig.fromEnvironment(Map.of(
            BridgeConfig.TOKEN_ENV, "0123456789abcdef0123456789abcde "
        )));
        assertThrows(IllegalStateException.class, () -> BridgeConfig.fromEnvironment(Map.of(
            BridgeConfig.TOKEN_ENV, "0123456789abcdef0123456789abcde!"
        )));
        assertThrows(IllegalStateException.class, () -> BridgeConfig.fromEnvironment(Map.of(
            BridgeConfig.TOKEN_ENV, "0123456789abcdef0123456789abcde\n"
        )));
    }
}
