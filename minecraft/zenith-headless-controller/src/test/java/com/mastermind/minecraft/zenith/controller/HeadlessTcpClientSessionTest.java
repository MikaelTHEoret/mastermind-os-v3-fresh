package com.mastermind.minecraft.zenith.controller;

import org.geysermc.mcprotocollib.protocol.data.game.chunk.PalettedWorldState;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class HeadlessTcpClientSessionTest {
    @Test
    void pinnedPaletteMetadataMatchesZenithRelease() {
        assertEquals(24, HeadlessTcpClientSession.INITIAL_SECTION_COUNT);
        assertEquals(32_366, HeadlessTcpClientSession.BLOCK_STATE_REGISTRY_SIZE);
        assertEquals(0, HeadlessTcpClientSession.AIR_BLOCK_STATE_ID);
        assertEquals(66, HeadlessTcpClientSession.BIOME_REGISTRY_SIZE);
        assertEquals(40, HeadlessTcpClientSession.PLAINS_BIOME_ID);
    }

    @Test
    void pinnedPaletteWidthsMatchMinecraftWireFormat() {
        var state = new PalettedWorldState(
            HeadlessTcpClientSession.INITIAL_SECTION_COUNT,
            HeadlessTcpClientSession.BLOCK_STATE_REGISTRY_SIZE,
            HeadlessTcpClientSession.AIR_BLOCK_STATE_ID,
            HeadlessTcpClientSession.BIOME_REGISTRY_SIZE,
            HeadlessTcpClientSession.PLAINS_BIOME_ID,
            it.unimi.dsi.fastutil.ints.IntSets.emptySet()
        );

        assertEquals(15, state.getBlockStatePaletteBitsPerEntry());
        assertEquals(7, state.getBiomePaletteBitsPerEntry());
        assertTrue(state.getFluidStates().isEmpty());
    }
}
