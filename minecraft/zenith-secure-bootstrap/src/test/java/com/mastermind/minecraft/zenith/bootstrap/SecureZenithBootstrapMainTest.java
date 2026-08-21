package com.mastermind.minecraft.zenith.bootstrap;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;

final class SecureZenithBootstrapMainTest {
    @AfterEach
    void clearProperties() {
        System.clearProperty(SecureZenithBootstrapMain.USERNAME_PROPERTY);
        System.clearProperty(SecureZenithBootstrapMain.UUID_PROPERTY);
        System.clearProperty(SecureZenithBootstrapMain.ACCESS_TOKEN_PROPERTY);
        System.clearProperty(SecureZenithBootstrapMain.REQUIRED_PROPERTY);
    }

    @Test
    void transfersOnlyCurrentSessionInsideProcessAndClearsIt() throws Exception {
        AtomicBoolean invoked = new AtomicBoolean();
        int status = SecureZenithBootstrapMain.run(new String[0], frame(), mainClass -> {
            assertEquals(SecureZenithBootstrapMain.ZENITH_MAIN_CLASS, mainClass);
            assertEquals("The_AlChemist___", System.getProperty(SecureZenithBootstrapMain.USERNAME_PROPERTY));
            assertEquals("996a56dd-fb3c-4f90-9158-1a608652ec77", System.getProperty(SecureZenithBootstrapMain.UUID_PROPERTY));
            assertEquals("safe-test-access-token-1234567890", System.getProperty(SecureZenithBootstrapMain.ACCESS_TOKEN_PROPERTY));
            assertEquals("true", System.getProperty(SecureZenithBootstrapMain.REQUIRED_PROPERTY));
            invoked.set(true);
        }, new PrintStream(new ByteArrayOutputStream()));

        assertEquals(0, status);
        assertEquals(true, invoked.get());
        assertCleared();
    }

    @Test
    void canonicalizesCompactMojangProfileUuidForZenith() throws Exception {
        int status = SecureZenithBootstrapMain.run(new String[0], frame(
            "996a56ddfb3c4f9091581a608652ec77"
        ), ignored -> assertEquals(
            "996a56dd-fb3c-4f90-9158-1a608652ec77",
            System.getProperty(SecureZenithBootstrapMain.UUID_PROPERTY)
        ), new PrintStream(new ByteArrayOutputStream()));

        assertEquals(0, status);
        assertCleared();
    }

    @Test
    void rejectsArgumentsBeforeReadingCredentials() throws Exception {
        var input = frame();
        int status = SecureZenithBootstrapMain.run(new String[] {"secret"}, input, ignored -> {}, null);
        assertEquals(64, status);
        assertEquals(input.available() > 0, true);
        assertCleared();
    }

    @Test
    void rejectsPreseededCredentialProperties() throws Exception {
        System.setProperty(SecureZenithBootstrapMain.ACCESS_TOKEN_PROPERTY, "forbidden");
        AtomicBoolean invoked = new AtomicBoolean();
        int status = SecureZenithBootstrapMain.run(new String[0], frame(), ignored -> invoked.set(true), null);
        assertEquals(65, status);
        assertFalse(invoked.get());
        assertCleared();
    }

    @Test
    void malformedFrameFailsWithoutInvokingZenith() {
        AtomicBoolean invoked = new AtomicBoolean();
        int status = SecureZenithBootstrapMain.run(
            new String[0],
            new ByteArrayInputStream(new byte[] {0, 0, 0, 1, 0}),
            ignored -> invoked.set(true),
            null
        );
        assertEquals(70, status);
        assertFalse(invoked.get());
        assertCleared();
    }

    @Test
    void invalidProfileUuidFailsBeforeInvokingZenith() throws Exception {
        AtomicBoolean invoked = new AtomicBoolean();
        int status = SecureZenithBootstrapMain.run(
            new String[0],
            frame("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"),
            ignored -> invoked.set(true),
            null
        );

        assertEquals(70, status);
        assertFalse(invoked.get());
        assertCleared();
    }

    private static ByteArrayInputStream frame() throws Exception {
        return frame("996a56dd-fb3c-4f90-9158-1a608652ec77");
    }

    private static ByteArrayInputStream frame(String uuid) throws Exception {
        String[] fields = {
            "The_AlChemist___",
            uuid,
            "safe-test-access-token-1234567890",
            "1234567890",
            "4a0cfea6-f8e8-49c0-ae5f-a9e6325e4ccb"
        };
        ByteArrayOutputStream payloadBytes = new ByteArrayOutputStream();
        try (DataOutputStream payload = new DataOutputStream(payloadBytes)) {
            payload.write("MFC1".getBytes(StandardCharsets.US_ASCII));
            for (String field : fields) {
                byte[] encoded = field.getBytes(StandardCharsets.UTF_8);
                payload.writeShort(encoded.length);
                payload.write(encoded);
            }
        }
        byte[] body = payloadBytes.toByteArray();
        ByteArrayOutputStream framedBytes = new ByteArrayOutputStream();
        try (DataOutputStream framed = new DataOutputStream(framedBytes)) {
            framed.writeInt(body.length);
            framed.write(body);
        }
        return new ByteArrayInputStream(framedBytes.toByteArray());
    }

    private static void assertCleared() {
        assertNull(System.getProperty(SecureZenithBootstrapMain.USERNAME_PROPERTY));
        assertNull(System.getProperty(SecureZenithBootstrapMain.UUID_PROPERTY));
        assertNull(System.getProperty(SecureZenithBootstrapMain.ACCESS_TOKEN_PROPERTY));
        assertNull(System.getProperty(SecureZenithBootstrapMain.REQUIRED_PROPERTY));
    }
}
