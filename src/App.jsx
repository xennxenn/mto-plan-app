import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Plus, FileDown, CheckCircle2, AlertCircle, Volume2, Cloud, CloudOff, Edit2, Trash2, User, Home, Type, Settings, X, Search, LogOut, Users, ArrowLeft, MapPin } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot, deleteDoc } from 'firebase/firestore';

// --- Firebase Initialization (Online Production) ---
const firebaseConfig = {
  apiKey: "AIzaSyBRehvxbOiCs9M2i2Wk5HswLsRWCCtDEws",
  authDomain: "mto-plan-app.firebaseapp.com",
  projectId: "mto-plan-app",
  storageBucket: "mto-plan-app.firebasestorage.app",
  messagingSenderId: "731599870174",
  appId: "1:731599870174:web:4664bf00aad0d25b66ca4f",
  measurementId: "G-HCE7EW82KF"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const safeAppId = "mto-plan-app";

// --- PDF Loader ---
const loadScript = (src) => new Promise((resolve, reject) => {
  const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
});

// --- Constants & Configs ---
const FIELD_MAP = { 'พื้นที่ด้านซ้าย': 'left', 'ความกว้างเฟรม': 'frameWidth', 'พื้นที่ด้านขวา': 'right', 'พื้นที่ด้านบน': 'top', 'ความสูงเฟรม': 'frameHeight', 'พื้นที่ด้านล่าง': 'bottom', 'ความสูงเต็ม': 'totalHeight', 'ความกว้างเต็ม': 'totalWidth' };
const FIELD_NAMES_REVERSE = Object.keys(FIELD_MAP).reduce((acc, key) => { acc[FIELD_MAP[key]] = key; return acc; }, {});

// 🧠 NLP Dictionary: คลังคำพ้องเสียงที่ไมค์มักจะได้ยินเพี้ยน (จัดเต็มทุกคำที่เป็นไปได้)
const VOICE_FIELDS = [
  { key: 'totalWidth', matchers: ['กว้างเต็ม', 'เต็มกว้าง', 'ความกว้างเต็ม', 'ขวางเต็ม', 'กวางเต็ม', 'รวมกว้าง', 'กว้างรวม'] },
  { key: 'totalHeight', matchers: ['สูงเต็ม', 'เต็มสูง', 'ความสูงเต็ม', 'ซูงเต็ม', 'สู้งเต็ม', 'รวมสูง', 'สูงรวม'] },
  { key: 'frameWidth', matchers: ['กว้างเฟรม', 'เฟรมกว้าง', 'ความกว้างเฟรม', 'กว้าง', 'กวาง', 'ขวาง', 'คว้าง', 'ความกว้าง', 'กาง', 'ว่าง'] },
  { key: 'frameHeight', matchers: ['สูงเฟรม', 'เฟรมสูง', 'ความสูงเฟรม', 'สูง', 'ซูง', 'สู้ง', 'ฝูง', 'จูง', 'ความสูง', 'ถุง'] },
  { key: 'left', matchers: ['ซ้าย', 'สาย', 'ซาย', 'ชาย', 'ตาย', 'ถ่าย', 'ท้าย', 'ป้าย', 'คล้าย', 'ซ้ายมือ', 'ย้าย', 'ร้าย', 'ด้านซ้าย'] },
  { key: 'right', matchers: ['ขวา', 'คว้า', 'คว่า', 'ปลา', 'ขา', 'ฝา', 'ฟ้า', 'หา', 'ปา', 'หว่า', 'ขวามือ', 'ผา', 'ด้านขวา'] },
  { key: 'top', matchers: ['บน', 'บ่น', 'ปน', 'คน', 'ทน', 'ชน', 'มนต์', 'วน', 'ด้านบน', 'ข้างบน', 'ยอด', 'หล่น', 'ผล'] },
  { key: 'bottom', matchers: ['ล่าง', 'ล้าง', 'ร่าง', 'ลาง', 'ทาง', 'สร้าง', 'ช้าง', 'ราง', 'บาง', 'ด้านล่าง', 'ข้างล่าง', 'พื้น', 'ห้าง'] }
];
const DEFAULT_OBSTACLES = ["ปลั๊กไฟ", "ปลั๊ก", "บิ้วอิน", "ตู้", "โคมไฟ", "แอร์", "เสา", "สวิตช์", "สายไฟ"];

export default function App() {
  // --- App States ---
  const [view, setView] = useState(() => { try { return localStorage.getItem('mto_view') || 'login'; } catch(e) { return 'login'; } }); 
  const [authUser, setAuthUser] = useState(() => { try { return JSON.parse(localStorage.getItem('mto_auth_user')) || null; } catch(e) { return null; } }); 
  const [dbUser, setDbUser] = useState(null); 
  
  // --- Data States ---
  const [projects, setProjects] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [obstacleTypes, setObstacleTypes] = useState(DEFAULT_OBSTACLES);
  
  // --- Current Selection ---
  const [activeProjectId, setActiveProjectId] = useState(() => { try { return localStorage.getItem('mto_active_project') || null; } catch(e) { return null; } });
  const [activeRoomId, setActiveRoomId] = useState(() => { try { return localStorage.getItem('mto_active_room') || null; } catch(e) { return null; } });
  const [activeItemId, setActiveItemId] = useState(() => { try { return localStorage.getItem('mto_active_item') || null; } catch(e) { return null; } });
  
  // --- Dashboard Filters ---
  const [searchTerm, setSearchTerm] = useState('');
  const [staffFilter, setStaffFilter] = useState('');

  // --- Voice & UI States ---
  const [isListening, setIsListening] = useState(false);
  const [isDictatingRemark, setIsDictatingRemark] = useState(false);
  const [logs, setLogs] = useState([]);
  const [speechFeedback, setSpeechFeedback] = useState("");
  const [saveStatus, setSaveStatus] = useState('saved'); 
  const [errorMessage, setErrorMessage] = useState('');
  const [isExporting, setIsExporting] = useState(false); // สถานะขณะ Export PDF
  
  // --- Modals ---
  const [promptConfig, setPromptConfig] = useState({ isOpen: false, title: '', defaultValue: '', onSubmit: null, type: 'text' });
  const [promptValue, setPromptValue] = useState('');
  const [confirmConfig, setConfirmConfig] = useState({ isOpen: false, title: '', message: '', onConfirm: null });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [newObstacleWord, setNewObstacleWord] = useState('');

  const [userModalConfig, setUserModalConfig] = useState({ isOpen: false });
  const [newUserConfig, setNewUserConfig] = useState({ username: '', name: '', password: '' });

  // --- Refs ---
  const recognitionRef = useRef(null);
  const pdfContainerRef = useRef(null);
  const latestVoiceHandlerRef = useRef();
  const isSpeakingRef = useRef(false); 
  const speakingTimeoutRef = useRef(null);

  // --- Login Form State ---
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');

  // --- Drag & Drop State ---
  const [draggingItem, setDraggingItem] = useState(null);
  const roomLayoutRef = useRef(null);

  // --- Persist State to LocalStorage ---
  useEffect(() => { try { if (authUser) localStorage.setItem('mto_auth_user', JSON.stringify(authUser)); else localStorage.removeItem('mto_auth_user'); } catch(e) {} }, [authUser]);
  useEffect(() => { try { localStorage.setItem('mto_view', view); } catch(e) {} }, [view]);
  useEffect(() => { try { if (activeProjectId) localStorage.setItem('mto_active_project', activeProjectId); else localStorage.removeItem('mto_active_project'); } catch(e) {} }, [activeProjectId]);
  useEffect(() => { try { if (activeRoomId) localStorage.setItem('mto_active_room', activeRoomId); else localStorage.removeItem('mto_active_room'); } catch(e) {} }, [activeRoomId]);
  useEffect(() => { try { if (activeItemId) localStorage.setItem('mto_active_item', activeItemId); else localStorage.removeItem('mto_active_item'); } catch(e) {} }, [activeItemId]);

  // --- Initialize Firebase Auth ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (error) { 
        setErrorMessage("ไม่สามารถเชื่อมต่อระบบบัญชีได้: กรุณาเปิดใช้งาน Anonymous Auth ใน Firebase"); 
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setDbUser);
    return () => unsubscribe();
  }, []);

  // --- Load PDF Library ---
  useEffect(() => {
    if (!window.html2pdf) {
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js')
        .catch(err => console.error("Error loading PDF library:", err));
    }
  }, []);

  // --- Fetch Data ---
  useEffect(() => {
    if (!dbUser) return;
    
    const projUnsub = onSnapshot(collection(db, 'artifacts', safeAppId, 'public', 'data', 'mto_projects'), (snap) => {
      const pData = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt);
      setProjects(pData);
      setSaveStatus('saved');
    }, (err) => { setErrorMessage("เกิดข้อผิดพลาดในการดึงข้อมูล: " + err.message); });

    const userUnsub = onSnapshot(collection(db, 'artifacts', safeAppId, 'public', 'data', 'mto_users'), (snap) => {
      const uData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setUsersList(uData);
    });

    const setUnsub = onSnapshot(doc(db, 'artifacts', safeAppId, 'public', 'data', 'mto_settings', 'config'), (docSnap) => {
      if (docSnap.exists() && docSnap.data().obstacleTypes) setObstacleTypes(docSnap.data().obstacleTypes);
    });

    return () => { projUnsub(); userUnsub(); setUnsub(); };
  }, [dbUser]);

  // --- Authentication Logic ---
  const handleLogin = (e) => {
    e.preventDefault();
    if (loginUser === 'Admin' && loginPass === '1234') {
      setAuthUser({ id: 'admin', username: 'Admin', name: 'Administrator', role: 'admin' });
      setView('dashboard');
      return;
    }
    const user = usersList.find(u => u.username === loginUser && u.password === loginPass);
    if (user) {
      setAuthUser(user);
      setView('dashboard');
    } else {
      setErrorMessage("Username หรือ Password ไม่ถูกต้อง");
    }
  };

  const handleLogout = () => {
    setAuthUser(null); setView('login'); setLoginUser(''); setLoginPass('');
    setActiveProjectId(null); setActiveRoomId(null); setActiveItemId(null);
  };

  // --- Core Functions ---
  const saveProject = async (projectData) => {
    if (!dbUser) return;
    setSaveStatus('saving');
    try {
      await setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'mto_projects', projectData.id), { ...projectData, updatedAt: Date.now() }, { merge: true });
      setSaveStatus('saved');
    } catch (e) { setSaveStatus('error'); }
  };

  const deleteProjectDb = async (projectId) => {
    if (!dbUser) return;
    try { await deleteDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'mto_projects', projectId)); } catch (e) {}
  };

  const saveSettings = async (newObstacles) => {
    setObstacleTypes(newObstacles);
    if (!dbUser) return;
    try { await setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'mto_settings', 'config'), { obstacleTypes: newObstacles }, { merge: true }); } catch (e) {}
  };

  const saveUserDb = async (userData) => {
    if (!dbUser) return;
    try { await setDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'mto_users', userData.id), userData, { merge: true }); } catch (e) {}
  };
  
  const deleteUserDb = async (userId) => {
    if (!dbUser) return;
    try { await deleteDoc(doc(db, 'artifacts', safeAppId, 'public', 'data', 'mto_users', userId)); } catch (e) {}
  };

  const addLog = (text, type = 'user') => setLogs(prev => [...prev.slice(-4), { text, type, time: new Date().toLocaleTimeString() }]);

  // 🗣️ ระบบตอบกลับเสียง (ลดเวลาหน่วง ไม่ให้ไมค์ดับนาน)
  const speak = (text) => {
    setSpeechFeedback(text);
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
      isSpeakingRef.current = true; 
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'th-TH';
      
      const estimatedTime = Math.max(1000, text.length * 80);
      speakingTimeoutRef.current = setTimeout(() => { isSpeakingRef.current = false; }, estimatedTime);
      utterance.onend = () => { clearTimeout(speakingTimeoutRef.current); isSpeakingRef.current = false; };
      utterance.onerror = () => { clearTimeout(speakingTimeoutRef.current); isSpeakingRef.current = false; };
      
      window.speechSynthesis.speak(utterance);
    }
  };

  // --- สมองกล NLP จัดการคำสั่งเสียง ---
  const handleVoiceCommand = (command) => {
    let rawCommand = command.trim().replace(/\.$/, '');
    addLog(`🎙️ ได้ยิน: "${rawCommand}"`, 'user'); 

    // 1. ทำความสะอาดข้อความ ลบหน่วย และคำลงท้าย
    let proc = rawCommand.toLowerCase()
      .replace(/(ครับ|ค่ะ|จ้ะ|จ้า|นะ|ฮะ|เลย)$/g, '')
      .replace(/\s*(ซม\.|ซม|เซนติเมตร|cm|มิลลิเมตร|มิล|mm\.|mm|เมตร|m\.|m)\s*/gi, '')
      .replace(/(\d+)\s*(จุด|ดอท)\s*(\d+)/g, '$1.$2') // "50 จุด 5" -> "50.5"
      .replace(/(\d+)\s*ครึ่ง/g, '$1.5') // "150 ครึ่ง" -> "150.5"
      .replace(/๐/g, '0').replace(/๑/g, '1').replace(/๒/g, '2').replace(/๓/g, '3')
      .replace(/๔/g, '4').replace(/๕/g, '5').replace(/๖/g, '6').replace(/๗/g, '7')
      .replace(/๘/g, '8').replace(/๙/g, '9')
      .replace(/ศูนย์/g, '0').replace(/เอ็ด/g, '1').replace(/ยี่/g, '2')
      .trim();

    if (!proc) return;

    const activeProject = projects.find(p => p.id === activeProjectId);
    if (!activeProject) {
      speak("กรุณาเลือกหรือสร้างโครงการก่อนครับ");
      return;
    }

    // --- โหมดจดหมายเหตุ (อัดเสียงต่อเนื่อง) ---
    if (activeItemId && activeRoomId) {
      const rIdx = activeProject.rooms.findIndex(r => r.id === activeRoomId);
      const iIdx = activeProject.rooms[rIdx].items.findIndex(i => i.id === activeItemId);

      if (isDictatingRemark) {
        if (proc.match(/^(เสร็จ|เสร็จสิ้น|พอแล้ว|เรียบร้อย)$/i)) {
          setIsDictatingRemark(false); 
          speak("บันทึกหมายเหตุเสร็จสิ้น"); 
          addLog("หยุดบันทึกหมายเหตุ", "system");
        } else {
          const newProj = JSON.parse(JSON.stringify(activeProject));
          const currentRemark = newProj.rooms[rIdx].items[iIdx].measurements.remark || '';
          newProj.rooms[rIdx].items[iIdx].measurements.remark = currentRemark ? currentRemark + ' ' + rawCommand : rawCommand;
          saveProject(newProj); 
          speak(`เพิ่มข้อความแล้ว`); 
          addLog(`หมายเหตุ: ${rawCommand}`, 'system');
        }
        return;
      }

      if (proc.match(/^(หมายเหตุ|จดหมายเหตุ|บันทึกย่อ|เพิ่มข้อความ|เพิ่มเติม)/)) {
        setIsDictatingRemark(true);
        let initialText = rawCommand.replace(/^(หมายเหตุ|จดหมายเหตุ|บันทึกย่อ|เพิ่มข้อความ|เพิ่มเติม)/, '').trim();
        if (initialText.startsWith('ว่า')) initialText = initialText.substring(3).trim();
        if (initialText) {
          const newProj = JSON.parse(JSON.stringify(activeProject));
          const currentRemark = newProj.rooms[rIdx].items[iIdx].measurements.remark || '';
          newProj.rooms[rIdx].items[iIdx].measurements.remark = currentRemark ? currentRemark + ' ' + initialText : initialText;
          saveProject(newProj);
          speak(`บันทึกหมายเหตุ: ${initialText}`); 
          addLog(`เริ่มหมายเหตุ: ${initialText}`, "system");
        } else {
          speak("เริ่มบันทึกหมายเหตุ พูดข้อความยาวๆ ได้เลยครับ หากเสร็จแล้วให้พูดว่า เสร็จสิ้น"); 
          addLog("เริ่มบันทึกหมายเหตุ", "system");
        }
        return;
      }
    }

    // --- คำสั่งพื้นฐาน (เริ่ม, หยุด, เปรียบเทียบ) ---
    const normalizeName = (name) => name.toLowerCase().replace(/\s+/g, '')
      .replace(/บ้าน|ปาน|บาง|พาน|ผ่าน|งาน|การ|ศาล/g, 'บาน').replace(/ที่/g, '')
      .replace(/หนึ่ง|นึง|เอ็ด/g, '1').replace(/สอง|ยี่/g, '2').replace(/สาม/g, '3')
      .replace(/สี่|ซี่/g, '4').replace(/ห้า/g, '5').replace(/หก/g, '6')
      .replace(/เจ็ด/g, '7').replace(/แปด/g, '8').replace(/เก้า/g, '9')
      .replace(/ศูนย์|โอ|o/g, '0');

    // ตรวจจับคำสั่งเลือกบาน (Start)
    const startMatch = proc.match(/^(เริ่ม|เลือก|แก้ไข|แก้|ทำ|ไปที่|เอา)\s*(.*)/i);
    if (startMatch) {
      const targetName = startMatch[2].trim();
      if (!targetName) { speak("กรุณาระบุชื่อบานด้วยครับ"); return; }
      const targetNorm = normalizeName(targetName);
      let fProjId = null, fRoomId = null, fItemId = null;
      
      const searchProjects = activeProjectId ? [projects.find(p => p.id === activeProjectId), ...projects.filter(p => p.id !== activeProjectId)] : projects;
      for (let p of searchProjects) {
        if (!p) continue;
        for (let r of p.rooms || []) {
          const item = (r.items || []).find(i => normalizeName(i.name) === targetNorm);
          if (item) { fProjId = p.id; fRoomId = r.id; fItemId = item.id; break; }
        }
        if (fItemId) break;
      }

      if (fItemId) {
        setActiveProjectId(fProjId); setActiveRoomId(fRoomId); setActiveItemId(fItemId); setIsDictatingRemark(false);
        speak(`เริ่มบันทึก ${targetName}`); addLog(`เลือกบาน: ${targetName}`, 'system');
      } else { speak(`หาบานชื่อ ${targetName} ไม่เจอครับ`); }
      return;
    }

    // คำสั่งหยุด (Stop)
    if (proc.match(/^(stop|สต็อป|หยุด|ยุด|ชุด|พอ|เสร็จ|เสร็จแล้ว)$/i) || proc.includes('หยุดบันทึก')) {
      setActiveItemId(null); setIsDictatingRemark(false); speak("ออกจากการบันทึกแล้วครับ"); return;
    }

    if (!activeItemId || !activeRoomId) {
      speak("กรุณาเลือกบานที่จะบันทึกก่อนครับ โดยพูดว่า เริ่ม ตามด้วยชื่อบาน");
      return;
    }

    const rIdx = activeProject.rooms.findIndex(r => r.id === activeRoomId);
    const iIdx = activeProject.rooms[rIdx].items.findIndex(i => i.id === activeItemId);
    const data = activeProject.rooms[rIdx].items[iIdx].measurements;
    const isInvalid = (val) => val === null || val === undefined || val === '';

    // ตรวจสอบความถูกต้อง (Compare)
    if (proc.includes('เทียบ') || proc.includes('เปรียบ') || proc.includes('เช็คยอด')) {
      if (proc.includes('สูง') || proc.includes('สู้ง') || proc.includes('ซูง')) {
        const { totalHeight, top, frameHeight, bottom } = data;
        if (isInvalid(totalHeight) || isInvalid(top) || isInvalid(frameHeight) || isInvalid(bottom)) { speak("ข้อมูลความสูงยังกรอกไม่ครบครับ"); return; }
        const sumParts = parseFloat(top) + parseFloat(frameHeight) + parseFloat(bottom);
        const total = parseFloat(totalHeight);
        const diff = Math.abs(total - sumParts);
        if (total === sumParts) speak("ยอดความสูงรวมตรงกันพอดีครับ"); else if (total > sumParts) speak(`ยอดความสูงเต็ม มากกว่าส่วนประกอบอยู่ ${diff}`); else speak(`ยอดความสูงเต็ม น้อยกว่าส่วนประกอบอยู่ ${diff}`);
      } else if (proc.includes('กว้าง') || proc.includes('กวาง') || proc.includes('ขวาง')) {
        const { totalWidth, left, frameWidth, right } = data;
        if (isInvalid(totalWidth) || isInvalid(left) || isInvalid(frameWidth) || isInvalid(right)) { speak("ข้อมูลความกว้างยังกรอกไม่ครบครับ"); return; }
        const sumParts = parseFloat(left) + parseFloat(frameWidth) + parseFloat(right);
        const total = parseFloat(totalWidth);
        const diff = Math.abs(total - sumParts);
        if (total === sumParts) speak("ยอดความกว้างรวมตรงกันพอดีครับ"); else if (total > sumParts) speak(`ยอดความกว้างเต็ม มากกว่าส่วนประกอบอยู่ ${diff}`); else speak(`ยอดความกว้างเต็ม น้อยกว่าส่วนประกอบอยู่ ${diff}`);
      }
      return;
    }

    // --- 2. ประมวลผลดึงตัวเลขและทิศทาง (หัวใจหลักของ NLP) ---
    const numMatch = proc.match(/[-+]?\d*\.?\d+/);
    const numVal = numMatch ? parseFloat(numMatch[0]) : null;

    let matchedDirKey = null;
    let matchedDirWord = '';
    
    // ค้นหาทิศทางที่แมตช์ได้ "ยาวที่สุดและชัดเจนที่สุด" ก่อน
    for (let field of VOICE_FIELDS) {
      for (let word of field.matchers) {
        if (proc.includes(word) && word.length > matchedDirWord.length) {
          matchedDirKey = field.key;
          matchedDirWord = word;
        }
      }
    }

    // ค้นหาสิ่งกีดขวางที่ถูกพูดถึง
    let matchedObstacle = null;
    let matchedObsWord = '';
    for (let obs of obstacleTypes) {
      let lObs = obs.toLowerCase();
      if (proc.includes(lObs) && lObs.length > matchedObsWord.length) {
        matchedObstacle = obs;
        matchedObsWord = lObs;
      }
    }

    // --- 3. ประมวลผล Action (สั่งงาน) ---
    if (numVal !== null) {
      // 🟢 กรณีที่ 1: เจอตัวเลข
      if (matchedDirKey) {
        const newProj = JSON.parse(JSON.stringify(activeProject));
        const displayDirName = FIELD_NAMES_REVERSE[matchedDirKey];

        if (matchedObstacle) {
          // ถ้ามีสิ่งกีดขวาง ต้องระบุทิศด้วย (ซ้าย ขวา บน ล่าง)
          if (['left', 'right', 'top', 'bottom'].includes(matchedDirKey)) {
            let obs = newProj.rooms[rIdx].items[iIdx].measurements.obstacles || [];
            const exIdx = obs.findIndex(o => o.label === matchedObstacle && o.side === matchedDirKey);
            if (exIdx >= 0) obs[exIdx].value = numVal; else obs.push({ label: matchedObstacle, side: matchedDirKey, value: numVal });
            newProj.rooms[rIdx].items[iIdx].measurements.obstacles = obs;
            saveProject(newProj);
            speak(`บันทึก ${matchedObstacle} ${displayDirName} ${numVal}`);
            addLog(`บันทึกสิ่งกีดขวาง: ${matchedObstacle} ${displayDirName} = ${numVal}`, 'system');
          } else {
            speak(`กรุณาระบุว่า ${matchedObstacle} อยู่ด้านซ้าย ขวา บน หรือ ล่าง ครับ`);
            addLog(`⚠️ ทิศทาง '${displayDirName}' ไม่รองรับสิ่งกีดขวาง`, 'system');
          }
        } else {
          // ขนาดปกติ
          newProj.rooms[rIdx].items[iIdx].measurements[matchedDirKey] = numVal;
          saveProject(newProj);
          speak(`บันทึก ${displayDirName} ${numVal}`);
          addLog(`บันทึก: ${displayDirName} = ${numVal}`, 'system');
        }
      } else {
        // 🔴 ได้ยินตัวเลข แต่ไม่รู้ว่าให้ใส่ช่องไหน
        speak(`ได้ยินเลข ${numVal} แต่ไม่ทราบว่าให้ใส่ช่องไหนครับ`);
        addLog(`⚠️ ฟังทิศทางไม่ออกสำหรับเลข ${numVal}`, 'system');
      }
    } else {
      // 🟢 กรณีที่ 2: ไม่เจอตัวเลข แต่เจอคีย์เวิร์ด
      if (matchedDirKey || matchedObstacle) {
         speak(`ให้ใส่ค่า ${matchedDirWord || matchedObsWord} เท่าไหร่ครับ`);
         addLog(`⚠️ ขาดตัวเลขสำหรับ ${matchedDirWord || matchedObsWord}`, 'system');
      } else {
        // ไม่เจอทั้งคู่ (พูดคุยทั่วไป)
        // ไม่ต้องทำอะไรเพื่อป้องกันเสียงรบกวนเวลาคุยกันเอง
      }
    }
  };

  useEffect(() => { latestVoiceHandlerRef.current = handleVoiceCommand; });

  // --- Voice Recognition Engine (แก้ปัญหาไมค์หลุด/หูหนวก) ---
  useEffect(() => {
    if (!isListening) return;

    let recognition = null;
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'th-TH';

      recognition.onresult = (event) => {
        if (isSpeakingRef.current) return; // ไม่ฟังตอนระบบกำลังพูดตอบ
        const transcript = event.results[event.resultIndex][0].transcript.trim();
        if (latestVoiceHandlerRef.current) latestVoiceHandlerRef.current(transcript);
      };

      recognition.onerror = (event) => {
        if (event.error === 'no-speech') return;
        if (event.error === 'network') { 
          setErrorMessage("เน็ตขัดข้อง ไมค์หลุด กรุณาลองกดปุ่มเปิดไมค์ใหม่อีกครั้ง"); 
          setIsListening(false); 
          return; 
        }
        if (event.error === 'not-allowed') { 
          setIsListening(false); 
          setErrorMessage("เบราว์เซอร์ไม่อนุญาตให้ใช้ไมค์ กรุณากดรูปกุญแจบน URL แล้วกด Allow (อนุญาต)"); 
        }
      };

      recognition.onend = () => {
        // หากผู้ใช้ยังไม่ได้สั่งปิดไมค์ ให้พยายาม Restart ไมค์เรื่อยๆ
        if (isListening) {
          try { recognition.start(); } catch (e) {}
        }
      };

      try {
        recognition.start();
      } catch (e) {
        console.error("Start voice error: ", e);
      }
      
      recognitionRef.current = recognition;
    } else {
      setErrorMessage("เบราว์เซอร์ไม่รองรับคำสั่งเสียง แนะนำให้ใช้ Google Chrome ครับ");
      setIsListening(false);
    }

    return () => {
      if (recognition) {
        recognition.onend = null; // ป้องกันการติด Loop รีสตาร์ทตัวเองตอนจะปิดแอป
        recognition.stop();
      }
    };
  }, [isListening]); 

  const toggleMic = () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    
    if (isListening) {
      setIsListening(false); 
      setIsDictatingRemark(false); 
      isSpeakingRef.current = false;
      addLog("ปิดไมโครโฟน", "system"); 
      speak("ปิดระบบรับคำสั่ง");
    } else {
      setIsListening(true);
      isSpeakingRef.current = false;
      addLog("เปิดไมโครโฟน พร้อมรับคำสั่ง...", "system"); 
      speak("พร้อมรับคำสั่ง");
    }
  };

  // --- UI Helpers ---
  const handlePrompt = (title, defaultValue, onSubmitAction) => {
    setPromptValue(defaultValue || ''); setPromptConfig({ isOpen: true, title, defaultValue, onSubmit: onSubmitAction });
  };
  const handleConfirm = (title, message, onConfirmAction) => {
    setConfirmConfig({ isOpen: true, title, message, onConfirm: onConfirmAction });
  };

  // --- CRUD Project ---
  const createProject = () => {
    handlePrompt("ชื่อลูกค้า / โครงการ:", "", (name) => {
      const newProj = { id: Date.now().toString(), customerName: name, createdBy: authUser.id, createdByName: authUser.name, createdAt: Date.now(), rooms: [] };
      saveProject(newProj);
      setActiveProjectId(newProj.id);
      setView('project');
    });
  };

  // --- CRUD Room & Items ---
  const addRoom = (projectId) => {
    handlePrompt("ระบุชื่อห้อง / พื้นที่บ้าน:", "", (name) => {
      const proj = projects.find(p => p.id === projectId);
      if(!proj) return;
      const newProj = JSON.parse(JSON.stringify(proj));
      newProj.rooms.push({ id: Date.now().toString(), name, roomRemark: '', items: [] });
      saveProject(newProj);
      setActiveRoomId(newProj.rooms[newProj.rooms.length - 1].id);
      setActiveItemId(null);
    });
  };

  const editRoom = (e, projectId, roomId) => {
    e.stopPropagation();
    const proj = projects.find(p => p.id === projectId);
    const r = proj?.rooms.find(r => r.id === roomId);
    if(!r) return;
    handlePrompt("แก้ไขชื่อห้อง:", r.name, (newName) => {
      const newProj = JSON.parse(JSON.stringify(proj));
      const rIdx = newProj.rooms.findIndex(rm => rm.id === roomId);
      newProj.rooms[rIdx].name = newName;
      saveProject(newProj);
    });
  };

  const deleteRoom = (e, projectId, roomId) => {
    e.stopPropagation();
    handleConfirm("ยืนยันการลบ", "ลบห้องและบานหน้าต่างทั้งหมดในห้องนี้ใช่หรือไม่?", () => {
      const proj = projects.find(p => p.id === projectId);
      if(!proj) return;
      const newProj = JSON.parse(JSON.stringify(proj));
      newProj.rooms = newProj.rooms.filter(r => r.id !== roomId);
      saveProject(newProj);
      if (activeRoomId === roomId) { setActiveRoomId(null); setActiveItemId(null); }
    });
  };

  const updateRoomRemark = (roomId, text) => {
    const proj = projects.find(p => p.id === activeProjectId);
    if(!proj) return;
    const newProj = JSON.parse(JSON.stringify(proj));
    const rIdx = newProj.rooms.findIndex(r => r.id === roomId);
    newProj.rooms[rIdx].roomRemark = text;
    saveProject(newProj);
  };

  const addItemAtPosition = (roomId, x, y) => {
    handlePrompt("ระบุชื่อบาน (เช่น บานที่ 1):", "", (name) => {
      const proj = projects.find(p => p.id === activeProjectId);
      if(!proj) return;
      const newProj = JSON.parse(JSON.stringify(proj));
      const rIdx = newProj.rooms.findIndex(r => r.id === roomId);
      const newItemId = Date.now().toString();
      newProj.rooms[rIdx].items.push({
        id: newItemId, name, x, y,
        measurements: { left: '', frameWidth: '', right: '', top: '', frameHeight: '', bottom: '', totalHeight: '', totalWidth: '', remark: '', obstacles: [] }
      });
      saveProject(newProj);
      setActiveItemId(newItemId);
    });
  };

  const editItem = (e, projectId, roomId, itemId) => {
    e.stopPropagation();
    const proj = projects.find(p => p.id === projectId);
    const r = (proj?.rooms || []).find(r => r.id === roomId);
    const i = (r?.items || []).find(i => i.id === itemId);
    if(!i) return;
    handlePrompt("แก้ไขชื่อบาน:", i.name, (newName) => {
      const newProj = JSON.parse(JSON.stringify(proj));
      const rIdx = newProj.rooms.findIndex(rm => rm.id === roomId);
      const iIdx = newProj.rooms[rIdx].items.findIndex(item => item.id === itemId);
      newProj.rooms[rIdx].items[iIdx].name = newName;
      saveProject(newProj);
    });
  };

  const deleteItem = (e, projectId, roomId, itemId) => {
    e.stopPropagation();
    handleConfirm("ยืนยันการลบ", "ลบบานนี้ใช่หรือไม่?", () => {
      const proj = projects.find(p => p.id === projectId);
      if(!proj) return;
      const newProj = JSON.parse(JSON.stringify(proj));
      const rIdx = newProj.rooms.findIndex(r => r.id === roomId);
      newProj.rooms[rIdx].items = newProj.rooms[rIdx].items.filter(i => i.id !== itemId);
      saveProject(newProj);
      if (activeItemId === itemId) setActiveItemId(null);
    });
  };

  // --- Setting Obstacle ---
  const handleAddObstacle = () => {
    if (newObstacleWord.trim()) {
      if (!obstacleTypes.includes(newObstacleWord.trim())) {
        const updated = [...obstacleTypes, newObstacleWord.trim()];
        saveSettings(updated);
      }
      setNewObstacleWord('');
    }
  };

  const removeObstacle = (word) => {
    const updated = obstacleTypes.filter(w => w !== word);
    saveSettings(updated);
  };

  // --- Interactive Room Layout Drag ---
  const handleRoomPointerDown = (e, itemId) => {
    e.stopPropagation(); setDraggingItem(itemId);
  };

  const handleRoomPointerMove = (e) => {
    if (!draggingItem || !roomLayoutRef.current || !activeRoomId || !activeProjectId) return;
    const rect = roomLayoutRef.current.getBoundingClientRect();
    let x = ((e.clientX - rect.left) / rect.width) * 100;
    let y = ((e.clientY - rect.top) / rect.height) * 100;
    x = Math.max(5, Math.min(95, x)); y = Math.max(5, Math.min(95, y));
    
    const newProjects = [...projects];
    const pIdx = newProjects.findIndex(p => p.id === activeProjectId);
    const rIdx = newProjects[pIdx].rooms.findIndex(r => r.id === activeRoomId);
    const iIdx = newProjects[pIdx].rooms[rIdx].items.findIndex(i => i.id === draggingItem);
    newProjects[pIdx].rooms[rIdx].items[iIdx].x = x;
    newProjects[pIdx].rooms[rIdx].items[iIdx].y = y;
    setProjects(newProjects);
  };

  const handleRoomPointerUp = () => {
    if (draggingItem) {
      setDraggingItem(null);
      saveProject(projects.find(p => p.id === activeProjectId)); 
    }
  };

  const handleRoomClickEmpty = (e) => {
    if (draggingItem) return;
    const rect = roomLayoutRef.current.getBoundingClientRect();
    let x = ((e.clientX - rect.left) / rect.width) * 100;
    let y = ((e.clientY - rect.top) / rect.height) * 100;
    addItemAtPosition(activeRoomId, x, y);
  };

  // --- Computed Variables ---
  let displayProjects = projects;
  if (authUser && authUser.role !== 'admin') displayProjects = projects.filter(p => p.createdBy === authUser.id);
  if (searchTerm) displayProjects = displayProjects.filter(p => p.customerName && p.customerName.toLowerCase().includes(searchTerm.toLowerCase()));
  if (authUser && authUser.role === 'admin' && staffFilter) displayProjects = displayProjects.filter(p => p.createdBy === staffFilter);

  const activeProject = projects.find(p => p.id === activeProjectId);
  const activeRoom = (activeProject?.rooms || []).find(r => r.id === activeRoomId);
  const activeItem = (activeRoom?.items || []).find(i => i.id === activeItemId);

  // 📝 ดึงข้อมูล "เฉพาะของลูกค้าคนปัจจุบัน" มาทำ PDF
  const currentProjectItems = activeProject ? (activeProject.rooms || []).flatMap(r => 
    (r.items || []).map(i => ({ ...i, roomName: r.name, customerName: activeProject.customerName, roomRemark: r.roomRemark }))
  ) : [];
  
  const pdfPages = [];
  for (let i = 0; i < currentProjectItems.length; i += 6) {
    pdfPages.push(currentProjectItems.slice(i, i + 6));
  }

  // --- การเซฟและแชร์เป็น PDF (เวอร์ชันใหม่) ---
  const generatePDF = () => {
    if (!window.html2pdf) { 
      setErrorMessage("ระบบ PDF กำลังโหลด กรุณารอสักครู่แล้วลองกดใหม่อีกครั้งครับ"); 
      return; 
    }
    if (!activeProject || pdfPages.length === 0) {
      setErrorMessage("ยังไม่มีข้อมูลบานหน้าต่างสำหรับสร้าง PDF ของลูกค้ารายนี้ครับ");
      return;
    }

    setIsExporting(true);
    const filename = `MTO_Plan_${activeProject.customerName || 'Export'}.pdf`;

    const opt = { 
      margin: 0, 
      filename: filename, 
      image: { type: 'jpeg', quality: 0.98 }, 
      html2canvas: { scale: 2, useCORS: true, logging: false }, 
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } 
    };

    // ใช้ html2pdf แบบรองรับการทำ Blob เพื่อนำไปแชร์ต่อ
    window.html2pdf().set(opt).from(pdfContainerRef.current).output('blob').then((blob) => {
       const file = new File([blob], filename, { type: 'application/pdf' });
       
       // ตรวจสอบระบบแชร์ของเครื่อง (มักจะมีบนมือถือ/แท็บเล็ต)
       if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({
            files: [file],
            title: filename,
            text: 'ส่งเอกสาร MTO Plan'
          }).then(() => {
             setIsExporting(false);
          }).catch(err => {
            // หากผู้ใช้กดยกเลิกแชร์ หรือเกิดข้อผิดพลาด ให้ใช้วิธีดาวน์โหลดลงเครื่องแทน
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            setIsExporting(false);
          });
       } else {
          // สำหรับ PC / Browser ที่ไม่มีเมนูแชร์ ให้ดาวน์โหลดลงเครื่องทันที
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
          setIsExporting(false);
       }
    }).catch(err => {
       console.error("PDF Generate Error:", err);
       setErrorMessage("เกิดข้อผิดพลาดในการสร้างไฟล์ PDF");
       setIsExporting(false);
    });
  };

  const getFlexValue = (val, defaultFlex) => { const num = parseFloat(val); return !isNaN(num) && num >= 0 ? Math.max(num, 0.001) : defaultFlex; };
  const getObstaclesBySide = (obsList, side) => (obsList || []).filter(o => o.side === side);

  const flexL = activeItem ? getFlexValue(activeItem.measurements.left, 1) : 1;
  const flexFW = activeItem ? getFlexValue(activeItem.measurements.frameWidth, 3) : 3;
  const flexR = activeItem ? getFlexValue(activeItem.measurements.right, 1) : 1;
  const flexT = activeItem ? getFlexValue(activeItem.measurements.top, 1) : 1;
  const flexFH = activeItem ? getFlexValue(activeItem.measurements.frameHeight, 3) : 3;
  const flexB = activeItem ? getFlexValue(activeItem.measurements.bottom, 1) : 1;

  return (
    <>
      {/* ---------------- LOGIN VIEW ---------------- */}
      {view === 'login' && (
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-extrabold text-indigo-600 mb-2">MTO Plan Coding</h1>
              <p className="text-slate-500">เข้าสู่ระบบเพื่อจัดการข้อมูล</p>
            </div>
            <form onSubmit={handleLogin} className="space-y-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Username / รหัสพนักงาน</label>
                <input type="text" className="w-full border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-indigo-500" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} required />
              </div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                <input type="password" className="w-full border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-indigo-500" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} required />
              </div>
              <button type="submit" className="w-full bg-indigo-600 text-white font-bold py-3 rounded-lg hover:bg-indigo-700 transition">เข้าสู่ระบบ</button>
            </form>
            {errorMessage && <p className="mt-4 text-red-500 text-sm text-center bg-red-50 p-2 rounded">{errorMessage}</p>}
          </div>
        </div>
      )}

      {/* ---------------- USERS MANAGEMENT VIEW ---------------- */}
      {view === 'users' && authUser?.role === 'admin' && (
        <div className="min-h-screen bg-slate-50">
          <header className="bg-indigo-600 text-white p-4 flex justify-between items-center shadow-md">
            <div className="flex items-center gap-4">
              <button onClick={() => setView('dashboard')} className="hover:bg-indigo-500 p-2 rounded-full"><ArrowLeft size={20}/></button>
              <h1 className="text-xl font-bold">จัดการบัญชีพนักงาน</h1>
            </div>
          </header>
          <main className="max-w-4xl mx-auto p-6">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-bold">รายชื่อพนักงานทั้งหมด</h2>
                <button onClick={() => {
                  setNewUserConfig({ username: '', name: '', password: '' });
                  setUserModalConfig({ isOpen: true });
                }} className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700"><Plus size={16}/> เพิ่มพนักงาน</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead><tr className="border-b-2 border-slate-200"><th className="p-3">รหัสพนักงาน</th><th className="p-3">ชื่อ</th><th className="p-3">รหัสผ่าน</th><th className="p-3 w-20">จัดการ</th></tr></thead>
                  <tbody>
                    {usersList.map(u => (
                      <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="p-3 font-medium text-slate-800">{u.username}</td><td className="p-3 text-slate-600">{u.name}</td><td className="p-3 text-slate-400 font-mono text-sm">{u.password}</td>
                        <td className="p-3"><button onClick={() => handleConfirm("ลบพนักงาน", `ยืนยันการลบ ${u.name}?`, () => deleteUserDb(u.id))} className="text-red-500 hover:bg-red-100 p-2 rounded"><Trash2 size={16}/></button></td>
                      </tr>
                    ))}
                    {usersList.length === 0 && <tr><td colSpan="4" className="text-center p-6 text-slate-400">ยังไม่มีข้อมูลพนักงาน</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </main>
        </div>
      )}

      {/* ---------------- DASHBOARD VIEW ---------------- */}
      {view === 'dashboard' && (
        <div className="min-h-screen bg-slate-50">
          <header className="bg-indigo-600 text-white p-4 flex justify-between items-center shadow-md">
            <h1 className="text-xl font-bold flex items-center gap-2"><MapPin size={24}/> MTO Plan Coding</h1>
            <div className="flex items-center gap-4">
              <span className="text-sm opacity-90 hidden md:inline">สวัสดี, {authUser?.name} ({authUser?.role})</span>
              {authUser?.role === 'admin' && <button onClick={() => setView('users')} className="p-2 hover:bg-indigo-500 rounded-full" title="จัดการพนักงาน"><Users size={20}/></button>}
              <button onClick={() => setIsSettingsOpen(true)} className="p-2 hover:bg-indigo-500 rounded-full" title="ตั้งค่าสิ่งกีดขวาง"><Settings size={20}/></button>
              <button onClick={handleLogout} className="p-2 hover:bg-indigo-500 rounded-full text-red-100" title="ออกจากระบบ"><LogOut size={20}/></button>
            </div>
          </header>
          <main className="max-w-6xl mx-auto p-4 sm:p-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
              <h2 className="text-2xl font-bold text-slate-800">รายชื่อลูกค้า / โครงการ</h2>
              <button onClick={createProject} className="bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2.5 rounded-full font-bold flex items-center gap-2 shadow-sm transition-transform hover:scale-105"><Plus size={20}/> สร้างโครงการใหม่</button>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6 flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18}/>
                <input type="text" placeholder="ค้นหาชื่อลูกค้า..." className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
              </div>
              {authUser?.role === 'admin' && (
                <select className="border border-slate-300 rounded-lg px-4 py-2 bg-white focus:ring-2 focus:ring-indigo-500 outline-none min-w-[200px]" value={staffFilter} onChange={e => setStaffFilter(e.target.value)}>
                  <option value="">พนักงานทั้งหมด</option>
                  {usersList.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayProjects.map(proj => (
                <div key={proj.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow cursor-pointer flex flex-col" onClick={() => { setActiveProjectId(proj.id); setActiveRoomId(proj.rooms?.[0]?.id || null); setActiveItemId(null); setView('project'); }}>
                  <div className="p-5 flex-1">
                    <h3 className="text-lg font-bold text-indigo-700 mb-1">{proj.customerName}</h3>
                    <p className="text-xs text-slate-500 mb-4">โดย: {proj.createdByName} | อัปเดต: {new Date(proj.updatedAt).toLocaleDateString('th-TH')}</p>
                    <div className="flex gap-4 text-sm text-slate-600">
                      <span className="bg-slate-100 px-3 py-1 rounded-full"><Home size={14} className="inline mr-1 -mt-0.5"/> {proj.rooms?.length || 0} ห้อง</span>
                      <span className="bg-slate-100 px-3 py-1 rounded-full">{(proj.rooms || []).reduce((acc, r) => acc + (r.items?.length || 0), 0)} บาน</span>
                    </div>
                  </div>
                  <div className="border-t border-slate-100 bg-slate-50 p-3 flex justify-end">
                    <button onClick={(e) => { e.stopPropagation(); handleConfirm("ลบโครงการ", `ลบข้อมูลโครงการ ${proj.customerName}?`, () => deleteProjectDb(proj.id)); }} className="text-slate-400 hover:text-red-500 p-1"><Trash2 size={16}/></button>
                  </div>
                </div>
              ))}
              {displayProjects.length === 0 && <div className="col-span-full py-12 text-center text-slate-400">ไม่พบข้อมูลโครงการ</div>}
            </div>
          </main>
        </div>
      )}

      {/* ---------------- PROJECT / ROOM EDITOR VIEW ---------------- */}
      {view === 'project' && (
        <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-10" onPointerMove={handleRoomPointerMove} onPointerUp={handleRoomPointerUp}>
          <header className="bg-indigo-600 text-white p-3 sm:p-4 shadow-md flex justify-between items-center sticky top-0 z-20">
            <div className="flex items-center gap-3">
              <button onClick={() => setView('dashboard')} className="p-2 bg-indigo-700 hover:bg-indigo-500 rounded-full transition"><ArrowLeft size={18}/></button>
              <div className="flex flex-col">
                <h1 className="text-base sm:text-xl font-bold truncate max-w-[150px] sm:max-w-[300px]">{activeProject?.customerName}</h1>
                <span className="text-[10px] opacity-80 flex items-center gap-1">
                  {saveStatus === 'saving' ? <Cloud className="animate-pulse" size={10} /> : <Cloud size={10} />}
                  {saveStatus === 'saving' ? 'กำลังบันทึก...' : 'บันทึกออนไลน์'}
                </span>
              </div>
            </div>
            <div className="flex gap-2 sm:gap-3">
              <button onClick={() => setIsSettingsOpen(true)} className="p-2 bg-indigo-700 hover:bg-indigo-500 rounded-full transition" title="ตั้งค่าสิ่งกีดขวาง"><Settings size={18}/></button>
              <button onClick={toggleMic} className={`flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-colors ${isListening ? 'bg-red-500 hover:bg-red-600 shadow-md animate-pulse' : 'bg-white text-indigo-600 hover:bg-indigo-50'}`}>
                {isListening ? <MicOff size={16} /> : <Mic size={16} />} <span className="hidden sm:inline">{isListening ? 'ปิดไมค์' : 'เปิดไมค์'}</span>
              </button>
              
              {/* ปุ่มกด Export และ Share PDF */}
              <button onClick={generatePDF} disabled={isExporting} className={`flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 ${isExporting ? 'bg-slate-400' : 'bg-emerald-500 hover:bg-emerald-600'} rounded-full text-white text-xs sm:text-sm font-medium transition-colors`}>
                <FileDown size={16} /> <span className="hidden sm:inline">{isExporting ? 'กำลังประมวลผล...' : 'Export PDF'}</span>
              </button>

            </div>
          </header>

          <main className="max-w-7xl mx-auto mt-4 sm:mt-6 px-2 sm:px-4 grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6">
            <div className="lg:col-span-1 bg-white rounded-xl shadow-sm p-4 border border-slate-200 self-start max-h-[40vh] lg:max-h-[85vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-semibold text-base sm:text-lg flex items-center gap-2"><Home size={18}/> พื้นที่ห้อง</h2>
                <button onClick={() => addRoom(activeProjectId)} className="p-1 text-indigo-600 hover:bg-indigo-50 rounded" title="เพิ่มห้อง"><Plus size={20}/></button>
              </div>

              {(!activeProject?.rooms || activeProject.rooms.length === 0) ? (
                 <div className="text-center text-slate-400 py-6 text-sm border-2 border-dashed rounded-lg cursor-pointer hover:bg-slate-50" onClick={() => addRoom(activeProjectId)}>กด + เพื่อเพิ่มห้องแรก</div>
              ) : (
                <div className="space-y-2">
                  {activeProject?.rooms.map(room => (
                    <div key={room.id} className={`border rounded-lg overflow-hidden transition-colors ${activeRoomId === room.id ? 'border-indigo-300 shadow-sm' : 'border-slate-200 bg-slate-50'}`}>
                      <div className={`p-2.5 text-sm font-bold cursor-pointer flex justify-between items-center group ${activeRoomId === room.id ? 'bg-indigo-50 text-indigo-800' : 'hover:bg-slate-100'}`} onClick={() => { setActiveRoomId(room.id); setActiveItemId(null); }}>
                        <span className="truncate pr-2">{room.name}</span>
                        <div className="flex gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 shrink-0">
                          <button onClick={(e) => editRoom(e, activeProjectId, room.id)} className="p-1 text-slate-400 hover:text-indigo-600"><Edit2 size={14}/></button>
                          <button onClick={(e) => deleteRoom(e, activeProjectId, room.id)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={14}/></button>
                        </div>
                      </div>
                      {activeRoomId === room.id && (
                        <div className="p-2 bg-white flex flex-col gap-1 border-t border-slate-100">
                          {room.items.length === 0 && <span className="text-[10px] text-slate-400 italic px-2">ยังไม่มีบาน</span>}
                          {room.items.map(item => (
                            <div key={item.id} className={`px-2 py-1.5 text-xs rounded cursor-pointer flex justify-between items-center group ${activeItemId === item.id ? 'bg-indigo-600 text-white' : 'hover:bg-slate-50 text-slate-600'}`} onClick={() => setActiveItemId(item.id)}>
                              <span className="truncate pr-2">{item.name}</span>
                              <button onClick={(e) => deleteItem(e, activeProjectId, room.id, item.id)} className={`p-1 shrink-0 ${activeItemId === item.id ? 'text-white/70 hover:text-white' : 'text-slate-300 hover:text-red-500 opacity-100 lg:opacity-0 lg:group-hover:opacity-100'}`}><Trash2 size={12}/></button>
                            </div>
                          ))}
                          <button onClick={() => addItemAtPosition(room.id, 50, 50)} className="w-full mt-1 py-1.5 text-xs text-indigo-600 border border-dashed border-indigo-200 rounded hover:bg-indigo-50 flex items-center justify-center gap-1"><Plus size={12}/> เพิ่มบาน</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-3 flex flex-col gap-4 sm:gap-6 h-full">
              {activeRoomId && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
                  <div className="p-4 flex-1 flex flex-col justify-center">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${isListening ? 'bg-red-500 animate-pulse' : 'bg-slate-300'}`}></div>
                      <span className="font-semibold text-sm">การสั่งงานด้วยเสียง</span>
                    </div>
                    <div className="text-xs text-slate-500 mb-2">เช่น: "เริ่ม บาน1", "ซ้าย 50", "บน 0", "ปลั๊ก ขวา 15", "หมายเหตุ..."</div>
                    <div className="bg-slate-50 h-16 sm:h-20 overflow-y-auto p-2 rounded border border-slate-100 text-xs font-mono flex flex-col justify-end">
                      {logs.map((log, idx) => (<div key={idx} className={`mb-0.5 ${log.type === 'system' ? 'text-indigo-600' : 'text-slate-600'}`}><span className="opacity-50 text-[10px]">[{log.time}]</span> {log.text}</div>))}
                      {logs.length === 0 && <span className="text-slate-400">ประวัติคำสั่ง...</span>}
                    </div>
                  </div>
                  <div className="p-4 w-full sm:w-1/3 bg-slate-50 flex flex-col justify-center">
                    <span className="text-xs font-bold text-slate-500 mb-1">สถานะระบบตอบกลับ</span>
                    {isDictatingRemark ? (
                      <div className="flex items-center gap-2 text-yellow-600 text-sm font-bold animate-pulse"><Type size={16}/> โหมดจดหมายเหตุ...</div>
                    ) : speechFeedback ? (
                      <div className="flex items-start gap-2 text-emerald-600 text-sm font-bold"><Volume2 size={16} className="mt-0.5 shrink-0"/> <span className="leading-tight">{speechFeedback}</span></div>
                    ) : (
                      <div className="text-slate-400 text-sm">รอรับคำสั่ง...</div>
                    )}
                  </div>
                </div>
              )}

              {activeRoom ? (
                <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 flex-1">
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 w-full lg:w-1/3 flex flex-col">
                     <div className="flex justify-between items-center mb-3">
                       <h3 className="font-bold text-slate-800 text-sm">ผังห้อง: {activeRoom.name}</h3>
                       <span className="text-[10px] text-slate-400">แตะเพื่อสร้าง / ลากเพื่อย้าย</span>
                     </div>
                     <input type="text" placeholder="หมายเหตุสำหรับห้องนี้..." className="w-full text-xs p-2 mb-3 border border-slate-200 rounded bg-yellow-50 focus:outline-none focus:border-yellow-400" value={activeRoom.roomRemark || ''} onChange={(e) => updateRoomRemark(activeRoom.id, e.target.value)} />
                     <div ref={roomLayoutRef} className="flex-1 w-full aspect-square bg-slate-100 border-2 border-slate-200 rounded-lg relative overflow-hidden cursor-crosshair touch-none" onClick={handleRoomClickEmpty}>
                        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'linear-gradient(#ccc 1px, transparent 1px), linear-gradient(90deg, #ccc 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
                        {(activeRoom.items || []).map(item => (
                          <div key={item.id} onPointerDown={(e) => handleRoomPointerDown(e, item.id)} onClick={(e) => { e.stopPropagation(); setActiveItemId(item.id); }} className={`absolute w-8 h-8 -ml-4 -mt-4 flex flex-col items-center justify-center cursor-grab active:cursor-grabbing transition-transform ${draggingItem === item.id ? 'scale-125 z-20' : 'hover:scale-110 z-10'}`} style={{ left: `${item.x || 50}%`, top: `${item.y || 50}%` }}>
                             <div className={`w-4 h-4 rounded-full shadow-md border-2 ${activeItemId === item.id ? 'bg-indigo-500 border-white animate-pulse' : 'bg-white border-slate-400'}`}></div>
                             <span className="mt-1 bg-white/90 text-[9px] font-bold px-1 rounded shadow-sm whitespace-nowrap pointer-events-none">{item.name}</span>
                          </div>
                        ))}
                     </div>
                  </div>

                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6 w-full lg:w-2/3 flex flex-col justify-center overflow-x-auto">
                    {activeItem ? (
                      <div className="min-w-[400px] max-w-2xl mx-auto w-full">
                        <div className="text-center mb-6">
                          <h3 className="text-lg sm:text-xl font-bold text-indigo-700">{activeItem.name}</h3>
                        </div>
                        <div className="relative w-full aspect-[4/3] bg-slate-50 border border-slate-200 rounded-lg p-4 font-mono select-none">
                          <div className="w-full h-full grid" style={{ gridTemplateColumns: `30px ${flexL}fr ${flexFW}fr ${flexR}fr 60px`, gridTemplateRows: `30px 30px ${flexT}fr ${flexFH}fr ${flexB}fr` }}>
                            
                            <div className="col-start-2 col-end-5 row-start-1 flex flex-col justify-end">
                              <div className="text-center text-blue-600 text-[10px] sm:text-xs font-bold">8. กว้างเต็ม: {activeItem.measurements.totalWidth || '-'}</div>
                              <div className="w-full border-b border-blue-400 h-1 border-l border-r mb-1"></div>
                            </div>
                            <div className="col-start-1 row-start-3 row-end-6 flex flex-row items-center justify-end pr-1">
                              <div className="h-full border-r border-blue-400 w-1 border-t border-b"></div>
                              <div className="text-blue-600 text-[10px] sm:text-xs font-bold -rotate-90 whitespace-nowrap">7. สูงเต็ม: {activeItem.measurements.totalHeight || '-'}</div>
                            </div>

                            <div className="col-start-2 row-start-2 flex items-end justify-center pb-1 border-b-2 border-r-2 border-orange-500 text-orange-700 font-bold text-[10px] sm:text-xs">1. ซ้าย: {activeItem.measurements.left !== '' ? activeItem.measurements.left : '-'}</div>
                            <div className="col-start-3 row-start-2 flex items-end justify-center pb-1 border-b-2 border-r-2 border-orange-500 text-orange-700 font-bold text-[10px] sm:text-xs">2. กว้าง: {activeItem.measurements.frameWidth !== '' ? activeItem.measurements.frameWidth : '-'}</div>
                            <div className="col-start-4 row-start-2 flex items-end justify-center pb-1 border-b-2 border-orange-500 text-orange-700 font-bold text-[10px] sm:text-xs">3. ขวา: {activeItem.measurements.right !== '' ? activeItem.measurements.right : '-'}</div>

                            <div className="col-start-5 row-start-3 flex items-center justify-start pl-2 border-l-2 border-b-2 border-orange-500 text-orange-700 font-bold text-[10px] sm:text-xs">4. บน: {activeItem.measurements.top !== '' ? activeItem.measurements.top : '-'}</div>
                            <div className="col-start-5 row-start-4 flex items-center justify-start pl-2 border-l-2 border-b-2 border-orange-500 text-orange-700 font-bold text-[10px] sm:text-xs">5. สูง: {activeItem.measurements.frameHeight !== '' ? activeItem.measurements.frameHeight : '-'}</div>
                            <div className="col-start-5 row-start-5 flex items-center justify-start pl-2 border-l-2 border-orange-500 text-orange-700 font-bold text-[10px] sm:text-xs">6. ล่าง: {activeItem.measurements.bottom !== '' ? activeItem.measurements.bottom : '-'}</div>

                            <div className="col-start-3 row-start-3 flex flex-col items-center justify-center gap-1 border-x border-dashed border-slate-200">
                              {getObstaclesBySide(activeItem.measurements.obstacles, 'top').map((o, i) => (<span key={i} className="bg-purple-100 text-purple-800 text-[9px] sm:text-[10px] px-1.5 rounded font-semibold whitespace-nowrap">{o.label}: {o.value}</span>))}
                            </div>
                            <div className="col-start-2 row-start-4 flex flex-col items-center justify-center gap-1 border-y border-dashed border-slate-200">
                              {getObstaclesBySide(activeItem.measurements.obstacles, 'left').map((o, i) => (<span key={i} className="bg-purple-100 text-purple-800 text-[9px] sm:text-[10px] px-1.5 rounded font-semibold whitespace-nowrap">{o.label}: {o.value}</span>))}
                            </div>
                            <div className="col-start-4 row-start-4 flex flex-col items-center justify-center gap-1 border-y border-dashed border-slate-200">
                              {getObstaclesBySide(activeItem.measurements.obstacles, 'right').map((o, i) => (<span key={i} className="bg-purple-100 text-purple-800 text-[9px] sm:text-[10px] px-1.5 rounded font-semibold whitespace-nowrap">{o.label}: {o.value}</span>))}
                            </div>
                            <div className="col-start-3 row-start-5 flex flex-col items-center justify-center gap-1 border-x border-dashed border-slate-200">
                              {getObstaclesBySide(activeItem.measurements.obstacles, 'bottom').map((o, i) => (<span key={i} className="bg-purple-100 text-purple-800 text-[9px] sm:text-[10px] px-1.5 rounded font-semibold whitespace-nowrap">{o.label}: {o.value}</span>))}
                            </div>

                            <div className="col-start-3 row-start-4 border-[3px] border-slate-800 bg-white relative shadow-sm">
                              <div className="w-full h-px bg-slate-300 absolute top-1/2"></div><div className="h-full w-px bg-slate-300 absolute left-1/2"></div>
                            </div>
                          </div>
                        </div>

                        {activeItem.measurements.remark && (
                          <div className="mt-4 bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded text-sm text-yellow-800 shadow-sm flex items-start gap-2">
                            <Type size={16} className="mt-0.5 shrink-0 opacity-50"/> <div><strong>หมายเหตุบาน:</strong> {activeItem.measurements.remark}</div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center text-slate-400 h-full flex flex-col items-center justify-center">
                        <MapPin size={48} className="opacity-20 mb-4" />
                        <p>เลือกบานจากผังห้องด้านซ้าย<br/>เพื่อดูและบันทึกขนาด</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-10 flex flex-col items-center justify-center text-slate-400 h-[60vh]">
                  <Home size={64} className="opacity-20 mb-4"/>
                  <p className="text-lg">กรุณาสร้างและเลือกห้องทางซ้ายมือก่อนครับ</p>
                </div>
              )}

            </div>
          </main>

          {/* --- Export PDF Hidden Template --- */}
          <div style={{ position: 'absolute', left: '-9999px', top: '-9999px', width: 0, height: 0, overflow: 'hidden' }}>
            <div ref={pdfContainerRef} style={{ background: 'white', width: '210mm' }} className="text-black font-sans">
              {pdfPages.length === 0 ? (
                <div className="p-10 text-center">ไม่มีข้อมูลสำหรับ Export</div>
              ) : (
                pdfPages.map((pageItems, pageIdx) => (
                  <div key={pageIdx} className="page" style={{ width: '210mm', height: '297mm', padding: '10mm', boxSizing: 'border-box', pageBreakAfter: 'always' }}>
                    <div className="text-center font-bold text-xl mb-4 border-b pb-2 flex justify-between items-end">
                      <span>รายงานขนาด (MTO Plan)</span> <span className="text-xs font-normal">หน้า {pageIdx + 1} / {pdfPages.length}</span>
                    </div>
                    
                    <div className="grid grid-cols-2 grid-rows-3 gap-4 h-[255mm]">
                      {pageItems.map((item, idx) => {
                        const pFlexL = getFlexValue(item.measurements.left, 1);
                        const pFlexFW = getFlexValue(item.measurements.frameWidth, 3);
                        const pFlexR = getFlexValue(item.measurements.right, 1);
                        const pFlexT = getFlexValue(item.measurements.top, 1);
                        const pFlexFH = getFlexValue(item.measurements.frameHeight, 3);
                        const pFlexB = getFlexValue(item.measurements.bottom, 1);

                        return (
                        <div key={idx} className="border border-gray-400 rounded p-2 flex flex-col items-center justify-start relative text-xs">
                          <div className="w-full bg-slate-100 p-1 mb-1 text-center rounded border border-slate-200 flex flex-col">
                            <span className="font-bold">{item.customerName} : {item.roomName} : {item.name}</span>
                            {item.roomRemark && <span className="text-[7px] text-slate-500 italic mt-0.5 text-left bg-white px-1 border border-slate-100">* {item.roomRemark}</span>}
                          </div>
                          
                          <div className="relative w-[95%] h-[65%] mt-1">
                            <div className="w-full h-full grid"
                              style={{ gridTemplateColumns: `20px ${pFlexL}fr ${pFlexFW}fr ${pFlexR}fr 35px`, gridTemplateRows: `15px 15px ${pFlexT}fr ${pFlexFH}fr ${pFlexB}fr` }}>
                               
                               <div className="col-start-2 col-end-5 row-start-1 flex flex-col justify-end">
                                 <div className="text-center text-blue-600 text-[8px] font-bold">กว้างเต็ม: {item.measurements.totalWidth || '-'}</div>
                                 <div className="w-full border-b border-blue-400 h-1 border-l border-r mb-0.5"></div>
                               </div>
                               <div className="col-start-1 row-start-3 row-end-6 flex flex-row items-center justify-end pr-0.5">
                                 <div className="h-full border-r border-blue-400 w-1 border-t border-b"></div>
                                 <div className="text-blue-600 text-[8px] font-bold -rotate-90 whitespace-nowrap">สูงเต็ม: {item.measurements.totalHeight || '-'}</div>
                               </div>

                               <div className="col-start-2 row-start-2 flex items-end justify-center pb-0.5 border-b border-r border-orange-500 text-orange-700 font-bold text-[7px]">ซ้าย: {item.measurements.left !== '' ? item.measurements.left : '-'}</div>
                               <div className="col-start-3 row-start-2 flex items-end justify-center pb-0.5 border-b border-r border-orange-500 text-orange-700 font-bold text-[7px]">กว้าง: {item.measurements.frameWidth !== '' ? item.measurements.frameWidth : '-'}</div>
                               <div className="col-start-4 row-start-2 flex items-end justify-center pb-0.5 border-b border-orange-500 text-orange-700 font-bold text-[7px]">ขวา: {item.measurements.right !== '' ? item.measurements.right : '-'}</div>

                               <div className="col-start-5 row-start-3 flex items-center justify-start pl-1 border-l border-b border-orange-500 text-orange-700 font-bold text-[7px]">บน: {item.measurements.top !== '' ? item.measurements.top : '-'}</div>
                               <div className="col-start-5 row-start-4 flex items-center justify-start pl-1 border-l border-b border-orange-500 text-orange-700 font-bold text-[7px]">สูง: {item.measurements.frameHeight !== '' ? item.measurements.frameHeight : '-'}</div>
                               <div className="col-start-5 row-start-5 flex items-center justify-start pl-1 border-l border-orange-500 text-orange-700 font-bold text-[7px]">ล่าง: {item.measurements.bottom !== '' ? item.measurements.bottom : '-'}</div>

                               <div className="col-start-3 row-start-3 flex flex-col items-center justify-center border-x border-dashed border-slate-200 gap-[1px]">
                                  {getObstaclesBySide(item.measurements.obstacles, 'top').map((o, i) => (<span key={i} className="text-[5px] font-bold text-purple-800 bg-purple-100 rounded px-0.5">{o.label}:{o.value}</span>))}
                               </div>
                               <div className="col-start-2 row-start-4 flex flex-col items-center justify-center border-y border-dashed border-slate-200 gap-[1px]">
                                  {getObstaclesBySide(item.measurements.obstacles, 'left').map((o, i) => (<span key={i} className="text-[5px] font-bold text-purple-800 bg-purple-100 rounded px-0.5">{o.label}:{o.value}</span>))}
                               </div>
                               <div className="col-start-4 row-start-4 flex flex-col items-center justify-center border-y border-dashed border-slate-200 gap-[1px]">
                                  {getObstaclesBySide(item.measurements.obstacles, 'right').map((o, i) => (<span key={i} className="text-[5px] font-bold text-purple-800 bg-purple-100 rounded px-0.5">{o.label}:{o.value}</span>))}
                               </div>
                               <div className="col-start-3 row-start-5 flex flex-col items-center justify-center border-x border-dashed border-slate-200 gap-[1px]">
                                  {getObstaclesBySide(item.measurements.obstacles, 'bottom').map((o, i) => (<span key={i} className="text-[5px] font-bold text-purple-800 bg-purple-100 rounded px-0.5">{o.label}:{o.value}</span>))}
                               </div>

                               <div className="col-start-3 row-start-4 border-[1.5px] border-slate-800 bg-white relative">
                                 <div className="w-full h-px bg-slate-300 absolute top-1/2"></div><div className="h-full w-px bg-slate-300 absolute left-1/2"></div>
                               </div>
                            </div>
                          </div>

                          {item.measurements.remark && (
                            <div className="w-[95%] mt-auto p-1.5 border border-yellow-300 bg-yellow-50 text-[8px] text-yellow-800 rounded mb-1">
                              <b>หมายเหตุบาน:</b> {item.measurements.remark}
                            </div>
                          )}
                        </div>
                      )})}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- Global UI Modals (Available in ALL views) --- */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800">ตั้งค่าคำศัพท์สิ่งกีดขวาง</h3>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
            </div>
            <div className="flex gap-2 mb-4">
              <input type="text" className="flex-1 border border-slate-300 rounded p-2 text-sm focus:outline-none focus:border-indigo-500" placeholder="เพิ่มคำศัพท์ใหม่..." value={newObstacleWord} onChange={(e) => setNewObstacleWord(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddObstacle()} />
              <button onClick={handleAddObstacle} className="bg-indigo-600 text-white px-3 py-2 rounded hover:bg-indigo-700 text-sm font-medium">เพิ่ม</button>
            </div>
            <div className="max-h-60 overflow-y-auto border border-slate-200 rounded divide-y divide-slate-100">
              {obstacleTypes.map((word, idx) => (
                <div key={idx} className="flex justify-between items-center p-2.5 hover:bg-slate-50">
                  <span className="text-sm font-medium text-slate-700">{word}</span>
                  <button onClick={() => removeObstacle(word)} className="text-red-500 hover:bg-red-50 p-1 rounded"><Trash2 size={16}/></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {userModalConfig.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold mb-4">เพิ่มพนักงานใหม่</h3>
            <div className="space-y-3 mb-4">
              <input type="text" placeholder="รหัสพนักงาน (Username)" className="w-full border border-slate-300 p-2 rounded focus:ring-2 focus:ring-indigo-500 outline-none" value={newUserConfig.username} onChange={e => setNewUserConfig({...newUserConfig, username: e.target.value})} />
              <input type="text" placeholder="ชื่อ-นามสกุลพนักงาน" className="w-full border border-slate-300 p-2 rounded focus:ring-2 focus:ring-indigo-500 outline-none" value={newUserConfig.name} onChange={e => setNewUserConfig({...newUserConfig, name: e.target.value})} />
              <input type="text" placeholder="รหัสผ่าน (Password)" className="w-full border border-slate-300 p-2 rounded focus:ring-2 focus:ring-indigo-500 outline-none" value={newUserConfig.password} onChange={e => setNewUserConfig({...newUserConfig, password: e.target.value})} />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setUserModalConfig({ isOpen: false })} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">ยกเลิก</button>
              <button onClick={() => {
                  if(newUserConfig.username && newUserConfig.name && newUserConfig.password) {
                      saveUserDb({ id: Date.now().toString(), username: newUserConfig.username, name: newUserConfig.name, password: newUserConfig.password, role: 'staff' });
                      setUserModalConfig({ isOpen: false });
                  } else {
                      setErrorMessage("กรุณากรอกข้อมูลให้ครบถ้วน");
                  }
              }} className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">บันทึก</button>
            </div>
          </div>
        </div>
      )}

      {promptConfig.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold mb-4">{promptConfig.title}</h3>
            <input type="text" autoFocus className="w-full border border-gray-300 rounded p-2 mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500" value={promptValue} onChange={(e) => setPromptValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && promptValue.trim()) { promptConfig.onSubmit(promptValue.trim()); setPromptConfig({ isOpen: false, title: '', defaultValue: '', onSubmit: null }); setPromptValue(''); } }} />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setPromptConfig({ isOpen: false, title: '', defaultValue: '', onSubmit: null }); setPromptValue(''); }} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">ยกเลิก</button>
              <button onClick={() => { if (promptValue.trim()) { promptConfig.onSubmit(promptValue.trim()); setPromptConfig({ isOpen: false, title: '', defaultValue: '', onSubmit: null }); setPromptValue(''); } }} className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50" disabled={!promptValue.trim()}>ตกลง</button>
            </div>
          </div>
        </div>
      )}

      {confirmConfig.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold mb-2 text-slate-800">{confirmConfig.title}</h3>
            <p className="text-slate-600 mb-6">{confirmConfig.message}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmConfig({ isOpen: false, title: '', message: '', onConfirm: null })} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded font-medium">ยกเลิก</button>
              <button onClick={() => { confirmConfig.onConfirm(); setConfirmConfig({ isOpen: false, title: '', message: '', onConfirm: null }); }} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 font-medium">ลบข้อมูล</button>
            </div>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="fixed bottom-4 right-4 bg-red-600 text-white p-4 rounded-lg shadow-lg flex items-center gap-3 z-50 max-w-sm">
          <AlertCircle size={24} className="shrink-0" />
          <div className="flex-1 text-sm">{errorMessage}</div>
          <button onClick={() => setErrorMessage('')} className="text-white/80 hover:text-white">&times;</button>
        </div>
      )}
    </>
  );
}