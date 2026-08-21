package com.mastermind.minecraft.familycore;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.mastermind.minecraft.familycore.protocol.FamilyCoreProtocol;
import org.junit.jupiter.api.Test;

final class FamilyCoreFeaturesTest {
    @Test
    void everyRuntimeFeatureStartsDisabled() {
        assertFalse(FamilyCoreFeatures.flags().isEmpty());
        assertEquals(0, FamilyCoreFeatures.flags().values().stream().filter(Boolean::booleanValue).count());
    }

    @Test
    void protocolConstantsMatchTheControlPlaneContract() {
        assertEquals("mastermind.family-core", FamilyCoreProtocol.NAME);
        assertEquals(1, FamilyCoreProtocol.VERSION);
        assertEquals(64 * 1024, FamilyCoreProtocol.MAX_PAYLOAD_BYTES);
        assertEquals(8, FamilyCoreProtocol.SERVER_MESSAGE_TYPES.size());
        assertEquals(5, FamilyCoreProtocol.CONTROL_MESSAGE_TYPES.size());
    }

    @Test
    void chatInputIsBoundedAndUntrusted() {
        assertEquals("hello", FamilyCoreProtocol.requireChatText("hello"));
        assertThrows(IllegalArgumentException.class, () -> FamilyCoreProtocol.requireChatText(""));
        assertThrows(IllegalArgumentException.class, () -> FamilyCoreProtocol.requireChatText("x".repeat(513)));
        assertThrows(IllegalArgumentException.class, () -> FamilyCoreProtocol.requireChatText("unsafe\u202Etext"));
    }

    @Test
    void sequencesMustBePositive() {
        assertEquals(1, FamilyCoreProtocol.requireSequence(1));
        assertThrows(IllegalArgumentException.class, () -> FamilyCoreProtocol.requireSequence(0));
    }
}
