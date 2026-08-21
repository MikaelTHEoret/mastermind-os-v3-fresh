package com.mastermind.minecraft.handback;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.UUID;

public final class HandbackAttestationCodec {
    public static final int KEY_BYTES = 32;
    public static final int MAX_FRAME_BYTES = 512;
    private static final int MAGIC = 0x4D4D4842;
    private static final int VERSION = 1;
    private static final int MAC_BYTES = 32;

    private HandbackAttestationCodec() {
    }

    public static byte[] encode(HandbackAttestation attestation, byte[] key) {
        requireKey(key);
        try {
            ByteArrayOutputStream payloadBytes = new ByteArrayOutputStream(192);
            try (DataOutputStream output = new DataOutputStream(payloadBytes)) {
                output.writeInt(MAGIC);
                output.writeByte(VERSION);
                writeUuid(output, attestation.serverSessionId());
                writeUuid(output, attestation.companionUuid());
                output.writeLong(attestation.sequence());
                output.writeLong(attestation.observedAtEpochMillis());
                output.writeUTF(attestation.dimension());
                output.writeDouble(attestation.x());
                output.writeDouble(attestation.y());
                output.writeDouble(attestation.z());
                output.writeBoolean(attestation.playerPresent());
                output.writeBoolean(attestation.alive());
                output.writeBoolean(attestation.onGround());
            }
            byte[] payload = payloadBytes.toByteArray();
            byte[] signature = sign(payload, key);
            byte[] frame = Arrays.copyOf(payload, payload.length + signature.length);
            System.arraycopy(signature, 0, frame, payload.length, signature.length);
            Arrays.fill(signature, (byte) 0);
            if (frame.length > MAX_FRAME_BYTES) throw new IllegalArgumentException("attestation frame is too large");
            return frame;
        } catch (IOException impossible) {
            throw new IllegalStateException("memory encoding failed", impossible);
        }
    }

    public static HandbackAttestation decode(byte[] frame, byte[] key) {
        requireKey(key);
        if (frame == null || frame.length <= MAC_BYTES || frame.length > MAX_FRAME_BYTES) {
            throw new IllegalArgumentException("attestation frame size is invalid");
        }
        byte[] payload = Arrays.copyOf(frame, frame.length - MAC_BYTES);
        byte[] received = Arrays.copyOfRange(frame, frame.length - MAC_BYTES, frame.length);
        byte[] expected = sign(payload, key);
        try {
            if (!MessageDigest.isEqual(received, expected)) {
                throw new IllegalArgumentException("attestation signature is invalid");
            }
            try (DataInputStream input = new DataInputStream(new ByteArrayInputStream(payload))) {
                if (input.readInt() != MAGIC || input.readUnsignedByte() != VERSION) {
                    throw new IllegalArgumentException("attestation version is invalid");
                }
                HandbackAttestation result = new HandbackAttestation(
                    readUuid(input), readUuid(input), input.readLong(), input.readLong(), input.readUTF(),
                    input.readDouble(), input.readDouble(), input.readDouble(),
                    input.readBoolean(), input.readBoolean(), input.readBoolean()
                );
                if (input.available() != 0) throw new IllegalArgumentException("attestation has trailing data");
                return result;
            }
        } catch (IOException error) {
            throw new IllegalArgumentException("attestation frame is malformed", error);
        } finally {
            Arrays.fill(payload, (byte) 0);
            Arrays.fill(received, (byte) 0);
            Arrays.fill(expected, (byte) 0);
        }
    }

    private static byte[] sign(byte[] payload, byte[] key) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(payload);
        } catch (GeneralSecurityException error) {
            throw new IllegalStateException("HMAC-SHA256 is unavailable", error);
        }
    }

    private static void requireKey(byte[] key) {
        if (key == null || key.length != KEY_BYTES) throw new IllegalArgumentException("attestation key must be 32 bytes");
    }

    private static void writeUuid(DataOutputStream output, UUID value) throws IOException {
        output.writeLong(value.getMostSignificantBits());
        output.writeLong(value.getLeastSignificantBits());
    }

    private static UUID readUuid(DataInputStream input) throws IOException {
        return new UUID(input.readLong(), input.readLong());
    }
}
