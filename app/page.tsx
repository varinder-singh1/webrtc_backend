"use client";
import { useEffect, useRef, useState } from "react";
import io, { Socket } from "socket.io-client";

const ROOM_ID = "demo-room";
let socket: Socket; // Global socket (not recreated on every render)

export default function Home() {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [role, setRole] = useState<"sharer" | "viewer" | null>(null);
  const peerConnections = useRef<{ [key: string]: RTCPeerConnection }>({});

  // ✅ Initialize socket only once
  useEffect(() => {
    if (!socket) {
      socket = io("https://rtc-backend.duckdns.org/");
      socket.on("connect", () =>
        console.log("✅ Socket connected:", socket.id)
      );
    }

    // 👂 Handle signaling events
    socket.on("viewer-joined", async (viewerId: string) => {
      console.log("👀 Viewer joined:", viewerId);
      if (role !== "sharer") return;

      const pc = createPeerConnection(viewerId);
      peerConnections.current[viewerId] = pc;

      // Attach screen tracks if already available
      const stream = localVideoRef.current?.srcObject as MediaStream | null;
      if (stream) {
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("offer", { viewerId, offer });
    });

    socket.on("offer", async ({ offer, sharerId }) => {
      if (role !== "viewer") return;
      const pc = createPeerConnection(sharerId);
      peerConnections.current[sharerId] = pc;

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer", { sharerId, answer });
    });

    socket.on("answer", async ({ answer, viewerId }) => {
      const pc = peerConnections.current[viewerId];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on("ice-candidate", ({ candidate, from }) => {
      const pc = peerConnections.current[from];
      if (pc && candidate)
        pc.addIceCandidate(new RTCIceCandidate(candidate));
    });
  }, [role]);

  // ✅ Create peer connection helper
  const createPeerConnection = (targetId: string) => {
    const pc = new RTCPeerConnection();

    pc.onicecandidate = (e) => {
      if (e.candidate)
        socket.emit("ice-candidate", {
          target: targetId,
          candidate: e.candidate,
        });
    };

    pc.ontrack = (e) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = e.streams[0];
      }
    };

    return pc;
  };

  // 🎥 Start screen sharing
  const startSharing = async () => {
    setRole("sharer");
    socket.emit("join-room", { roomId: ROOM_ID, role: "sharer" });

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
  };

  // 👁️ Start viewing
  const startViewing = async () => {
    setRole("viewer");
    socket.emit("join-room", { roomId: ROOM_ID, role: "viewer" });
  };

  return (
    <div className="flex flex-col items-center gap-4 p-4">
      <h1 className="text-2xl font-bold">WebRTC Screen Sharing</h1>

      <div className="flex gap-4">
        <button
          onClick={startSharing}
          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
        >
          Start Sharing
        </button>

        <button
          onClick={startViewing}
          className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded"
        >
          Start Viewing
        </button>
      </div>

      <div className="mt-6 flex flex-col items-center">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="w-96 border rounded"
        />
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-96 border rounded mt-4"
        />
      </div>
    </div>
  );
}
