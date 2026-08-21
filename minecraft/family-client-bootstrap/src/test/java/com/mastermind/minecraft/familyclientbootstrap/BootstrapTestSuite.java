package com.mastermind.minecraft.familyclientbootstrap;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class BootstrapTestSuite {
    private static final String USERNAME = "FamilyAgent";
    private static final String UUID = "00112233-4455-6677-8899-aabbccddeeff";
    private static final String TOKEN = "test-token-value.never-log-this";
    private static final String XUID = "12345678901234567890";
    private static final String CLIENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

    private BootstrapTestSuite() {}

    public static void main(String[] arguments) throws Exception {
        List<TestCase> tests = List.of(
            test("valid frame is strict, closes stdin, and redacts toString", BootstrapTestSuite::validFrame),
            test("truncated frame is rejected and stdin is closed", BootstrapTestSuite::truncatedFrame),
            test("oversized frame is rejected before allocation", BootstrapTestSuite::oversizedFrame),
            test("malformed UTF-8 is rejected", BootstrapTestSuite::malformedUtf8),
            test("trailing payload data is rejected", BootstrapTestSuite::trailingPayload),
            test("bytes after the declared frame are rejected", BootstrapTestSuite::bytesAfterFrame),
            test("credential validation rejects unsafe token characters", BootstrapTestSuite::unsafeToken),
            test("profile requires exact known options and environment port", BootstrapTestSuite::profileValidation),
            test("game arguments are deterministic and complete", BootstrapTestSuite::argumentConstruction),
            test("runner invokes only KnotClient and clears argument references", BootstrapTestSuite::runnerContract),
            test("invalid profile closes credential stdin without reading it", BootstrapTestSuite::invalidProfileDoesNotReadCredentials),
            test("runner diagnostics never echo dependency failures", BootstrapTestSuite::runnerRedaction),
            test("reflective seam accepts only public static void main", BootstrapTestSuite::reflectionSignature),
            test("reflective target exception is redacted", BootstrapTestSuite::reflectionRedaction)
        );
        int passed = 0;
        for (TestCase test : tests) {
            try {
                test.body().run();
                passed += 1;
                System.out.println("PASS " + test.name());
            } catch (Throwable failure) {
                System.err.println("FAIL " + test.name() + ": " + failure.getClass().getSimpleName());
                throw failure;
            }
        }
        System.out.println("Bootstrap tests passed: " + passed + "/" + tests.size());
    }

    private static void validFrame() throws Exception {
        TrackingInputStream input = new TrackingInputStream(validFrameBytes());
        CredentialPayload credentials = CredentialPayloadReader.readAndClose(input);
        equal(USERNAME, credentials.usernameArgument());
        equal("00112233445566778899aabbccddeeff", credentials.uuidArgument());
        equal(TOKEN, credentials.accessTokenArgument());
        equal(XUID, credentials.xuidArgument());
        equal(CLIENT_ID, credentials.clientIdArgument());
        check(input.closed, "credential stdin was not closed");
        check(!credentials.toString().contains(TOKEN), "credential toString leaked the token");
        credentials.close();
        check(credentials.isCleared(), "credential character buffers were not cleared");
    }

    private static void truncatedFrame() throws Exception {
        byte[] valid = validFrameBytes();
        TrackingInputStream input = new TrackingInputStream(Arrays.copyOf(valid, valid.length - 3));
        BootstrapFailure failure = expectFailure(() -> CredentialPayloadReader.readAndClose(input));
        equal(BootstrapFailure.Kind.CREDENTIAL_FRAME_INVALID, failure.kind());
        check(input.closed, "truncated stdin was not closed");
        check(!failure.getMessage().contains(TOKEN), "failure leaked token");
    }

    private static void oversizedFrame() throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (DataOutputStream data = new DataOutputStream(output)) {
            data.writeInt(CredentialPayloadReader.MAX_FRAME_BYTES + 1);
        }
        TrackingInputStream input = new TrackingInputStream(output.toByteArray());
        expectFailure(() -> CredentialPayloadReader.readAndClose(input));
        check(input.closed, "oversized stdin was not closed");
    }

    private static void malformedUtf8() throws Exception {
        byte[][] values = validFieldBytes();
        values[0] = new byte[] {(byte) 0xc3, 0x28};
        BootstrapFailure failure = expectFailure(() -> CredentialPayloadReader.readAndClose(new ByteArrayInputStream(frame(values))));
        check(failure.getMessage().contains("strict UTF-8"), "strict UTF-8 diagnostic was not returned");
    }

    private static void trailingPayload() throws Exception {
        byte[] valid = validFrameBytes();
        int declared = readInt(valid, 0);
        byte[] modified = Arrays.copyOf(valid, valid.length + 1);
        writeInt(modified, 0, declared + 1);
        modified[modified.length - 1] = 0x42;
        BootstrapFailure failure = expectFailure(() -> CredentialPayloadReader.readAndClose(new ByteArrayInputStream(modified)));
        check(failure.getMessage().contains("trailing"), "trailing data was not diagnosed");
    }

    private static void bytesAfterFrame() throws Exception {
        byte[] valid = validFrameBytes();
        byte[] modified = Arrays.copyOf(valid, valid.length + 1);
        modified[modified.length - 1] = 0x42;
        BootstrapFailure failure = expectFailure(() -> CredentialPayloadReader.readAndClose(new ByteArrayInputStream(modified)));
        check(failure.getMessage().contains("after the declared frame"), "post-frame data was not diagnosed");
    }

    private static void unsafeToken() throws Exception {
        BootstrapFailure failure = expectFailure(() -> credentials("bad token"));
        check(!failure.getMessage().contains("bad token"), "validation echoed a token");
    }

    private static void profileValidation() throws Exception {
        LaunchProfile valid = LaunchProfile.parse(profileArguments(), environment());
        equal(25565, valid.serverPort());
        String[] unknown = profileArguments();
        unknown[0] = "--access-token";
        BootstrapFailure unknownFailure = expectFailure(() -> LaunchProfile.parse(unknown, environment()));
        equal(BootstrapFailure.Kind.PROFILE_INVALID, unknownFailure.kind());
        BootstrapFailure portFailure = expectFailure(() -> LaunchProfile.parse(profileArguments(), Map.of()));
        equal(BootstrapFailure.Kind.PROFILE_INVALID, portFailure.kind());
        String[] relative = profileArguments();
        relative[1] = "relative-game";
        expectFailure(() -> LaunchProfile.parse(relative, environment()));
    }

    private static void argumentConstruction() throws Exception {
        CredentialPayload credentials = credentials(TOKEN);
        try {
            String[] arguments = GameArguments.create(LaunchProfile.parse(profileArguments(), environment()), credentials);
            Map<String, String> pairs = pairs(arguments);
            equal(USERNAME, pairs.get("--username"));
            equal("00112233445566778899aabbccddeeff", pairs.get("--uuid"));
            equal(TOKEN, pairs.get("--accessToken"));
            equal(CLIENT_ID, pairs.get("--clientId"));
            equal(XUID, pairs.get("--xuid"));
            equal(false, pairs.containsKey("--userType"));
            equal(false, pairs.containsKey("--server"));
            equal(false, pairs.containsKey("--port"));
            equal("127.0.0.1:25565", pairs.get("--quickPlayMultiplayer"));
            equal(11, pairs.size());
        } finally {
            credentials.close();
        }
    }

    private static void runnerContract() throws Exception {
        TrackingInputStream input = new TrackingInputStream(validFrameBytes());
        String[][] captured = new String[1][];
        String[] capturedClass = new String[1];
        ByteArrayOutputStream errorBytes = new ByteArrayOutputStream();
        int status = FamilyClientBootstrap.run(profileArguments(), input, environment(), (className, arguments) -> {
            capturedClass[0] = className;
            captured[0] = arguments;
            equal(TOKEN, pairs(arguments).get("--accessToken"));
        }, new PrintStream(errorBytes, true, StandardCharsets.UTF_8));
        equal(0, status);
        equal(FamilyClientBootstrap.FABRIC_MAIN_CLASS, capturedClass[0]);
        check(input.closed, "runner did not close stdin");
        check(errorBytes.size() == 0, "successful runner emitted an error");
        check(Arrays.stream(captured[0]).allMatch(item -> item == null), "runner retained game argument references");
    }

    private static void runnerRedaction() throws Exception {
        ByteArrayOutputStream errorBytes = new ByteArrayOutputStream();
        int status = FamilyClientBootstrap.run(
            profileArguments(),
            new ByteArrayInputStream(validFrameBytes()),
            environment(),
            (className, arguments) -> { throw new IllegalStateException("dependency echoed " + TOKEN); },
            new PrintStream(errorBytes, true, StandardCharsets.UTF_8)
        );
        equal(70, status);
        String diagnostic = errorBytes.toString(StandardCharsets.UTF_8);
        check(!diagnostic.contains(TOKEN), "runner diagnostic leaked token");
        check(!diagnostic.contains("dependency echoed"), "runner diagnostic leaked dependency detail");
    }

    private static void invalidProfileDoesNotReadCredentials() {
        FailOnReadInputStream input = new FailOnReadInputStream();
        String[] invalid = profileArguments();
        invalid[0] = "--access-token";
        ByteArrayOutputStream errorBytes = new ByteArrayOutputStream();
        int status = FamilyClientBootstrap.run(
            invalid,
            input,
            environment(),
            (className, arguments) -> { throw new AssertionError("Fabric must not run for an invalid profile"); },
            new PrintStream(errorBytes, true, StandardCharsets.UTF_8)
        );
        equal(64, status);
        equal(0, input.reads);
        check(input.closed, "invalid profile did not close unread credential stdin");
        check(!errorBytes.toString(StandardCharsets.UTF_8).contains(TOKEN), "profile diagnostic leaked token");
    }

    private static void reflectionSignature() throws Exception {
        CapturingMain.arguments = null;
        ReflectiveMainInvoker invoker = new ReflectiveMainInvoker(BootstrapTestSuite.class.getClassLoader());
        String[] values = {"one", "two"};
        invoker.invoke(CapturingMain.class.getName(), values);
        check(CapturingMain.arguments == values, "reflective main did not receive the original argument array");
        BootstrapFailure failure = expectFailure(() -> invoker.invoke(NonStaticMain.class.getName(), values));
        equal(BootstrapFailure.Kind.FABRIC_ENTRYPOINT_UNAVAILABLE, failure.kind());
    }

    private static void reflectionRedaction() throws Exception {
        ReflectiveMainInvoker invoker = new ReflectiveMainInvoker(BootstrapTestSuite.class.getClassLoader());
        BootstrapFailure failure = expectFailure(() -> invoker.invoke(ThrowingMain.class.getName(), new String[] {TOKEN}));
        equal(BootstrapFailure.Kind.FABRIC_ENTRYPOINT_FAILED, failure.kind());
        check(!failure.getMessage().contains(TOKEN), "reflection failure leaked token");
    }

    private static CredentialPayload credentials(String token) throws BootstrapFailure {
        return new CredentialPayload(
            USERNAME.toCharArray(), UUID.toCharArray(), token.toCharArray(), XUID.toCharArray(), CLIENT_ID.toCharArray()
        );
    }

    private static String[] profileArguments() {
        String root = Path.of(System.getProperty("java.io.tmpdir"), "mastermind-family-client-test").toAbsolutePath().normalize().toString();
        return new String[] {
            "--game-dir", Path.of(root, "game").toString(),
            "--assets-dir", Path.of(root, "assets").toString(),
            "--asset-index", "26",
            "--version", "fabric-loader-0.19.3-26.2",
            "--version-type", "mastermind-family",
        };
    }

    private static Map<String, String> environment() {
        return Map.of(LaunchProfile.SERVER_PORT_ENVIRONMENT_KEY, "25565");
    }

    private static byte[] validFrameBytes() throws IOException {
        return frame(validFieldBytes());
    }

    private static byte[][] validFieldBytes() {
        return new byte[][] {
            USERNAME.getBytes(StandardCharsets.UTF_8),
            UUID.getBytes(StandardCharsets.UTF_8),
            TOKEN.getBytes(StandardCharsets.UTF_8),
            XUID.getBytes(StandardCharsets.UTF_8),
            CLIENT_ID.getBytes(StandardCharsets.UTF_8),
        };
    }

    private static byte[] frame(byte[][] fields) throws IOException {
        ByteArrayOutputStream payloadBytes = new ByteArrayOutputStream();
        try (DataOutputStream payload = new DataOutputStream(payloadBytes)) {
            payload.write(new byte[] {'M', 'F', 'C', '1'});
            for (byte[] field : fields) {
                payload.writeShort(field.length);
                payload.write(field);
            }
        }
        byte[] body = payloadBytes.toByteArray();
        ByteArrayOutputStream framedBytes = new ByteArrayOutputStream();
        try (DataOutputStream framed = new DataOutputStream(framedBytes)) {
            framed.writeInt(body.length);
            framed.write(body);
        }
        return framedBytes.toByteArray();
    }

    private static Map<String, String> pairs(String[] arguments) {
        check(arguments.length % 2 == 0, "arguments were not key/value pairs");
        Map<String, String> result = new LinkedHashMap<>();
        for (int index = 0; index < arguments.length; index += 2) {
            check(result.put(arguments[index], arguments[index + 1]) == null, "duplicate game argument");
        }
        return result;
    }

    private static int readInt(byte[] value, int offset) {
        return (value[offset] & 0xff) << 24 | (value[offset + 1] & 0xff) << 16
            | (value[offset + 2] & 0xff) << 8 | value[offset + 3] & 0xff;
    }

    private static void writeInt(byte[] value, int offset, int item) {
        value[offset] = (byte) (item >>> 24);
        value[offset + 1] = (byte) (item >>> 16);
        value[offset + 2] = (byte) (item >>> 8);
        value[offset + 3] = (byte) item;
    }

    private static BootstrapFailure expectFailure(ThrowingRunnable operation) throws Exception {
        try {
            operation.run();
        } catch (BootstrapFailure failure) {
            return failure;
        }
        throw new AssertionError("Expected BootstrapFailure");
    }

    private static void equal(Object expected, Object actual) {
        if (!java.util.Objects.equals(expected, actual)) throw new AssertionError("Values differed");
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static TestCase test(String name, ThrowingRunnable body) {
        return new TestCase(name, body);
    }

    private record TestCase(String name, ThrowingRunnable body) {}

    @FunctionalInterface
    private interface ThrowingRunnable {
        void run() throws Exception;
    }

    private static final class TrackingInputStream extends ByteArrayInputStream {
        private boolean closed;

        TrackingInputStream(byte[] bytes) {
            super(bytes);
        }

        @Override
        public void close() throws IOException {
            closed = true;
            super.close();
        }
    }

    private static final class FailOnReadInputStream extends InputStream {
        private int reads;
        private boolean closed;

        @Override
        public int read() {
            reads += 1;
            throw new AssertionError("Credential stdin must not be read for an invalid profile");
        }

        @Override
        public int read(byte[] bytes, int offset, int length) {
            reads += 1;
            throw new AssertionError("Credential stdin must not be read for an invalid profile");
        }

        @Override
        public void close() {
            closed = true;
        }
    }

    public static final class CapturingMain {
        static String[] arguments;
        private CapturingMain() {}
        public static void main(String[] values) { arguments = values; }
    }

    public static final class NonStaticMain {
        public void main(String[] values) { /* Invalid by design. */ }
    }

    public static final class ThrowingMain {
        private ThrowingMain() {}
        public static void main(String[] values) { throw new IllegalStateException(values[0]); }
    }
}
