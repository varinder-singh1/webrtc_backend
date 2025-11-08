"use client";
import { useEffect, useRef, useState } from "react";
import io, { Socket } from "socket.io-client";

const ROOM_ID = "demo-room";
let socket: Socket;

export default function Home() {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [role, setRole] = useState<"sharer" | "viewer" | null>(null);

  // Store peer connections per target
  const peerConnections = useRef<{ [key: string]: RTCPeerConnection }>({});

  // Initialize socket once
  useEffect(() => {
    if (!socket) {
      socket = io("https://weatherradar.duckdns.org/");
      socket.on("connect", () => console.log("✅ Socket connected:", socket.id));
    }
  }, []);

  // Attach signaling events once
  useEffect(() => {
    if (!socket) return;

    // Viewer joined (sharer side)
    const handleViewerJoined = async (viewerId: string) => {
      if (role !== "sharer") return;

      const pc = createPeerConnection(viewerId);
      peerConnections.current[viewerId] = pc;

      const stream = localVideoRef.current?.srcObject as MediaStream | null;
      if (stream) stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("offer", { viewerId, offer });
    };

    // Receive offer (viewer side)
    const handleOffer = async ({ offer, sharerId }: any) => {
      if (role !== "viewer") return;

      const pc = createPeerConnection(sharerId);
      peerConnections.current[sharerId] = pc;

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer", { sharerId, answer });
    };

    // Receive answer (sharer side)
    const handleAnswer = async ({ answer, viewerId }: any) => {
      const pc = peerConnections.current[viewerId];
      if (!pc) return;

      if (pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      } else {
        console.warn("Cannot set remote, signaling state:", pc.signalingState);
      }
    };

    // ICE candidate
    const handleIceCandidate = ({ candidate, from }: any) => {
      const pc = peerConnections.current[from];
      if (pc && candidate) pc.addIceCandidate(new RTCIceCandidate(candidate));
    };

    socket.on("viewer-joined", handleViewerJoined);
    socket.on("offer", handleOffer);
    socket.on("answer", handleAnswer);
    socket.on("ice-candidate", handleIceCandidate);

    return () => {
      socket.off("viewer-joined", handleViewerJoined);
      socket.off("offer", handleOffer);
      socket.off("answer", handleAnswer);
      socket.off("ice-candidate", handleIceCandidate);
    };
  }, [role]);

  // Create peer connection
  const createPeerConnection = (targetId: string) => {
    const pc = new RTCPeerConnection();

    pc.onicecandidate = (e) => {
      if (e.candidate)
        socket.emit("ice-candidate", { target: targetId, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
    };

    return pc;
  };

  const startSharing = async () => {
    setRole("sharer");
    socket.emit("join-room", { roomId: ROOM_ID, role: "sharer" });

    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
  };

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
