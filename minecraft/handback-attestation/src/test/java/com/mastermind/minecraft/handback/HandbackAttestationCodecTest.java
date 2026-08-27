package com.mastermind.minecraft.handback;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

final class HandbackAttestationCodecTest {
    private static final byte[] KEY = new byte[HandbackAttestationCodec.KEY_BYTES];
    private static final HandbackAttestation ATTESTATION = new HandbackAttestation(
        UUID.fromString("11111111-1111-4111-8111-111111111111"),
        UUID.fromString("22222222-2222-4222-8222-222222222222"),
        7, 1_777_000_000_000L, "minecraft:overworld", 10.25, 64.0, -3.5,
        true, true, true
    );

    static {
        for (int index = 0; index < KEY.length; index++) KEY[index] = (byte) index;
    }

    @Test
    void roundTripsAnAuthenticatedBoundedFrame() {
        byte[] frame = HandbackAttestationCodec.encode(ATTESTATION, KEY);
        assertEquals(ATTESTATION, HandbackAttestationCodec.decode(frame, KEY));
    }

    @Test
    void rejectsTamperingWrongKeysTrailingDataAndInvalidKeys() {
        byte[] frame = HandbackAttestationCodec.encode(ATTESTATION, KEY);
        frame[20] ^= 1;
        assertThrows(IllegalArgumentException.class, () -> HandbackAttestationCodec.decode(frame, KEY));

        byte[] valid = HandbackAttestationCodec.encode(ATTESTATION, KEY);
        byte[] wrongKey = Arrays.copyOf(KEY, KEY.length);
        wrongKey[0] ^= 1;
        assertThrows(IllegalArgumentException.class, () -> HandbackAttestationCodec.decode(valid, wrongKey));
        assertThrows(IllegalArgumentException.class, () -> HandbackAttestationCodec.decode(Arrays.copyOf(valid, valid.length + 1), KEY));
        assertThrows(IllegalArgumentException.class, () -> HandbackAttestationCodec.encode(ATTESTATION, new byte[31]));
    }

    @Test
    void rejectsInconsistentAbsentPlayerFacts() {
        assertThrows(IllegalArgumentException.class, () -> new HandbackAttestation(
            ATTESTATION.serverSessionId(), ATTESTATION.companionUuid(), 1, ATTESTATION.observedAtEpochMillis(),
            ATTESTATION.dimension(), 0, 0, 0, false, true, false
        ));
    }
}
