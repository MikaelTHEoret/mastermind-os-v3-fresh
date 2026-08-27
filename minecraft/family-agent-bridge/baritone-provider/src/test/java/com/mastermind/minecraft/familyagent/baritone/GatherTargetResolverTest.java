package com.mastermind.minecraft.familyagent.baritone;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

final class GatherTargetResolverTest {
    @Test
    void mapsBlocksToTheInventoryItemsThatProveGatherCompletion() {
        assertEquals("minecraft:oak_log", GatherTargetResolver.expectedItemId("minecraft:oak_log"));
        assertEquals("minecraft:coal", GatherTargetResolver.expectedItemId("minecraft:coal_ore"));
        assertEquals("minecraft:raw_iron", GatherTargetResolver.expectedItemId("minecraft:iron_ore"));
        assertEquals("minecraft:cobblestone", GatherTargetResolver.expectedItemId("minecraft:stone"));
    }
}
