"""
JARVIS Agent - Modern Dark GUI
==============================
Total black glassmorphism UI with animations.
Uses customtkinter for a modern look.
Falls back to standard tkinter if customtkinter is not available.

Run: python jarvis_gui.py
"""

import os
import sys
import threading
import time
import platform
import json
from datetime import datetime
from typing import Optional, Dict, Any

# Try customtkinter first, fall back to tkinter
try:
    import customtkinter as ctk
    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("blue")
    HAS_CTK = True
except ImportError:
    HAS_CTK = False

import tkinter as tk
from tkinter import font as tkfont

# ============== COLORS ==============
class Theme:
    """Total black glassmorphism color palette."""
    BG = "#000000"
    BG_CARD = "#0a0a0a"
    BG_CARD_HOVER = "#111111"
    BG_ELEVATED = "#141414"
    BG_GLASS = "#0d0d0d"
    BG_INPUT = "#0f0f0f"
    
    BORDER = "#1a1a1a"
    BORDER_SUBTLE = "#141414"
    BORDER_ACCENT = "#2563eb"
    BORDER_GLASS = "#1f1f1f"
    
    TEXT = "#fafafa"
    TEXT_DIM = "#a0a0a0"
    TEXT_MUTED = "#666666"
    TEXT_ACCENT = "#60a5fa"
    
    ACCENT = "#3b82f6"
    ACCENT_HOVER = "#2563eb"
    ACCENT_GLOW = "#1d4ed8"
    ACCENT_DIM = "#1e3a5f"
    
    SUCCESS = "#22c55e"
    SUCCESS_DIM = "#14532d"
    WARNING = "#f59e0b"
    WARNING_DIM = "#78350f"
    ERROR = "#ef4444"
    ERROR_DIM = "#7f1d1d"
    
    PURPLE = "#a855f7"
    CYAN = "#06b6d4"
    PINK = "#ec4899"
    ORANGE = "#f97316"


class AnimatedValue:
    """Simple animation helper for smooth transitions."""
    def __init__(self, start=0.0, target=0.0, duration=300):
        self.current = start
        self.target = target
        self.duration = duration
        self._start_time = 0
        self._start_val = start
        self._animating = False
    
    def animate_to(self, target):
        self.target = target
        self._start_val = self.current
        self._start_time = time.time() * 1000
        self._animating = True
    
    def update(self) -> float:
        if not self._animating:
            return self.current
        elapsed = (time.time() * 1000) - self._start_time
        progress = min(elapsed / self.duration, 1.0)
        # Ease out cubic
        t = 1 - (1 - progress) ** 3
        self.current = self._start_val + (self.target - self._start_val) * t
        if progress >= 1.0:
            self.current = self.target
            self._animating = False
        return self.current
    
    @property
    def is_animating(self):
        return self._animating


class GlassFrame(tk.Frame):
    """A frame that simulates glassmorphism with layered borders."""
    def __init__(self, parent, corner_radius=12, border_color=None, **kwargs):
        bg = kwargs.pop("bg", Theme.BG_CARD)
        kwargs["bg"] = bg
        kwargs["highlightbackground"] = border_color or Theme.BORDER
        kwargs["highlightthickness"] = 1
        kwargs["bd"] = 0
        super().__init__(parent, **kwargs)


class StatusDot(tk.Canvas):
    """Animated status indicator dot."""
    def __init__(self, parent, size=10, color=Theme.SUCCESS, **kwargs):
        super().__init__(parent, width=size+4, height=size+4, 
                        bg=parent.cget("bg"), highlightthickness=0, **kwargs)
        self.size = size
        self.color = color
        self._pulse_alpha = 1.0
        self._pulse_dir = -1
        self._draw()
    
    def _draw(self):
        self.delete("all")
        cx, cy = (self.size+4)/2, (self.size+4)/2
        r = self.size / 2
        # Glow
        self.create_oval(cx-r-2, cy-r-2, cx+r+2, cy+r+2, 
                        fill="", outline=self.color, width=1)
        # Core dot
        self.create_oval(cx-r, cy-r, cx+r, cy+r, fill=self.color, outline="")
    
    def set_color(self, color):
        self.color = color
        self._draw()


class JarvisGUI:
    """Main GUI Application for JARVIS PC Agent."""
    
    def __init__(self, agent=None):
        self.agent = agent
        self.root = tk.Tk()
        self.root.title("JARVIS Agent")
        self.root.configure(bg=Theme.BG)
        self.root.minsize(460, 640)
        self.root.geometry("480x720")
        
        # Remove default window chrome on Windows for cleaner look
        if platform.system() == "Windows":
            try:
                self.root.overrideredirect(False)
                # Dark title bar on Windows 11
                import ctypes
                hwnd = ctypes.windll.user32.GetForegroundWindow()
                DWMWA_USE_IMMERSIVE_DARK_MODE = 20
                ctypes.windll.dwmapi.DwmSetWindowAttribute(
                    hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE,
                    ctypes.byref(ctypes.c_int(1)), ctypes.sizeof(ctypes.c_int)
                )
            except Exception:
                pass
        
        # Icon
        try:
            icon_path = os.path.join(os.path.dirname(__file__), "icon.ico")
            if os.path.exists(icon_path):
                self.root.iconbitmap(icon_path)
        except Exception:
            pass
        
        # Fonts
        self._setup_fonts()
        
        # State
        self.current_tab = "dashboard"
        self._status_data = {
            "connected": False,
            "device_name": platform.node(),
            "pairing_code": "------",
            "cpu": 0,
            "memory": 0,
            "volume": 50,
            "brightness": 50,
            "p2p_mode": "cloud",
            "local_ips": [],
            "uptime": "0:00:00",
            "commands_executed": 0,
        }
        self._logs = []
        self._start_time = time.time()
        
        # Build UI
        self._build_ui()
        
        # Start status update loop
        self._update_loop()
    
    def _setup_fonts(self):
        families = tkfont.families()
        # Try modern fonts
        mono_candidates = ["JetBrains Mono", "Cascadia Code", "Fira Code", "Consolas", "Courier New"]
        sans_candidates = ["Inter", "Segoe UI", "SF Pro Display", "Helvetica Neue", "Arial"]
        
        self.font_mono = "Consolas"
        for f in mono_candidates:
            if f in families:
                self.font_mono = f
                break
        
        self.font_sans = "Segoe UI"
        for f in sans_candidates:
            if f in families:
                self.font_sans = f
                break
        
        self.FONT_TITLE = (self.font_sans, 18, "bold")
        self.FONT_HEADING = (self.font_sans, 13, "bold")
        self.FONT_BODY = (self.font_sans, 11)
        self.FONT_SMALL = (self.font_sans, 9)
        self.FONT_MONO = (self.font_mono, 10)
        self.FONT_MONO_SMALL = (self.font_mono, 9)
        self.FONT_BIG_NUMBER = (self.font_mono, 28, "bold")
    
    def _build_ui(self):
        """Build the complete UI."""
        # Main container
        self.main = tk.Frame(self.root, bg=Theme.BG)
        self.main.pack(fill="both", expand=True)
        
        # Header bar
        self._build_header()
        
        # Content area with tabs
        self.content = tk.Frame(self.main, bg=Theme.BG)
        self.content.pack(fill="both", expand=True, padx=16, pady=(0, 16))
        
        # Tab bar
        self._build_tab_bar()
        
        # Tab content frames
        self.tab_frames = {}
        self._build_dashboard_tab()
        self._build_logs_tab()
        self._build_settings_tab()
        
        # Show default tab
        self._switch_tab("dashboard")
    
    def _build_header(self):
        """Top header with logo, status, and minimize/close."""
        header = tk.Frame(self.main, bg=Theme.BG, height=56)
        header.pack(fill="x", padx=16, pady=(12, 8))
        header.pack_propagate(False)
        
        # Left: Logo + title
        left = tk.Frame(header, bg=Theme.BG)
        left.pack(side="left", fill="y")
        
        # Animated orb
        self.status_orb = tk.Canvas(left, width=32, height=32, bg=Theme.BG, highlightthickness=0)
        self.status_orb.pack(side="left", padx=(0, 10))
        self._draw_orb(False)
        
        title_frame = tk.Frame(left, bg=Theme.BG)
        title_frame.pack(side="left")
        
        tk.Label(title_frame, text="JARVIS", font=self.FONT_TITLE,
                fg=Theme.TEXT, bg=Theme.BG).pack(anchor="w")
        
        self.subtitle_label = tk.Label(title_frame, text="Connecting...", 
                                       font=self.FONT_SMALL, fg=Theme.TEXT_MUTED, bg=Theme.BG)
        self.subtitle_label.pack(anchor="w")
        
        # Right: Status badge
        right = tk.Frame(header, bg=Theme.BG)
        right.pack(side="right", fill="y")
        
        self.status_badge = tk.Label(right, text="  OFFLINE  ", font=(self.font_sans, 9, "bold"),
                                     fg=Theme.ERROR, bg=Theme.ERROR_DIM,
                                     padx=8, pady=2)
        self.status_badge.pack(side="right", pady=12)
        
        # Version
        tk.Label(right, text="v5.2.0", font=self.FONT_SMALL,
                fg=Theme.TEXT_MUTED, bg=Theme.BG).pack(side="right", padx=(0, 8), pady=12)
    
    def _draw_orb(self, connected=False):
        """Draw the animated status orb."""
        self.status_orb.delete("all")
        cx, cy = 16, 16
        if connected:
            # Glow ring
            self.status_orb.create_oval(2, 2, 30, 30, fill="", outline=Theme.ACCENT, width=1)
            # Inner orb with gradient effect
            self.status_orb.create_oval(6, 6, 26, 26, fill=Theme.ACCENT, outline=Theme.ACCENT_HOVER, width=1)
            # Highlight
            self.status_orb.create_oval(10, 8, 18, 14, fill="#93c5fd", outline="")
        else:
            self.status_orb.create_oval(6, 6, 26, 26, fill=Theme.BG_ELEVATED, outline=Theme.BORDER, width=1)
            self.status_orb.create_oval(10, 10, 22, 22, fill=Theme.TEXT_MUTED, outline="")
    
    def _build_tab_bar(self):
        """Minimal tab bar with animated underline."""
        bar = tk.Frame(self.content, bg=Theme.BG, height=40)
        bar.pack(fill="x", pady=(0, 12))
        bar.pack_propagate(False)
        
        self.tab_buttons = {}
        tabs = [
            ("dashboard", "◉ Dashboard"),
            ("logs", "◎ Logs"),
            ("settings", "⚙ Settings"),
        ]
        
        for tab_id, label in tabs:
            btn = tk.Label(bar, text=label, font=self.FONT_BODY,
                          fg=Theme.TEXT_MUTED, bg=Theme.BG, cursor="hand2",
                          padx=12, pady=8)
            btn.pack(side="left")
            btn.bind("<Button-1>", lambda e, t=tab_id: self._switch_tab(t))
            btn.bind("<Enter>", lambda e, b=btn: b.configure(fg=Theme.TEXT_ACCENT))
            btn.bind("<Leave>", lambda e, b=btn, t=tab_id: 
                    b.configure(fg=Theme.TEXT if self.current_tab == t else Theme.TEXT_MUTED))
            self.tab_buttons[tab_id] = btn
        
        # Underline indicator
        self.tab_underline = tk.Frame(bar, bg=Theme.ACCENT, height=2)
    
    def _switch_tab(self, tab_id):
        """Switch visible tab with transition."""
        self.current_tab = tab_id
        
        # Update button styles
        for tid, btn in self.tab_buttons.items():
            if tid == tab_id:
                btn.configure(fg=Theme.TEXT)
            else:
                btn.configure(fg=Theme.TEXT_MUTED)
        
        # Show/hide frames
        for tid, frame in self.tab_frames.items():
            if tid == tab_id:
                frame.pack(fill="both", expand=True)
            else:
                frame.pack_forget()
    
    def _build_dashboard_tab(self):
        """Dashboard with status cards, metrics, and pairing."""
        frame = tk.Frame(self.content, bg=Theme.BG)
        self.tab_frames["dashboard"] = frame
        
        # Scrollable content
        canvas = tk.Canvas(frame, bg=Theme.BG, highlightthickness=0, bd=0)
        scrollbar = tk.Scrollbar(frame, orient="vertical", command=canvas.yview)
        scroll_frame = tk.Frame(canvas, bg=Theme.BG)
        
        scroll_frame.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=scroll_frame, anchor="nw", tags="scroll_window")
        canvas.configure(yscrollcommand=scrollbar.set)
        
        canvas.pack(side="left", fill="both", expand=True)
        # Don't show scrollbar for cleaner look, but enable mouse wheel
        canvas.bind_all("<MouseWheel>", lambda e: canvas.yview_scroll(int(-1*(e.delta/120)), "units"))
        
        # Make scroll_frame fill width
        def _resize_scroll(event):
            canvas.itemconfig("scroll_window", width=event.width)
        canvas.bind("<Configure>", _resize_scroll)
        
        # === Connection Status Card ===
        conn_card = self._card(scroll_frame)
        conn_card.pack(fill="x", pady=(0, 8))
        
        conn_top = tk.Frame(conn_card, bg=Theme.BG_CARD)
        conn_top.pack(fill="x", padx=16, pady=(16, 8))
        
        tk.Label(conn_top, text="CONNECTION", font=(self.font_sans, 9, "bold"),
                fg=Theme.TEXT_MUTED, bg=Theme.BG_CARD).pack(side="left")
        
        self.conn_dot = StatusDot(conn_top, size=8, color=Theme.ERROR)
        self.conn_dot.pack(side="right")
        
        self.conn_mode_label = tk.Label(conn_card, text="Cloud Relay", font=self.FONT_HEADING,
                                        fg=Theme.TEXT, bg=Theme.BG_CARD)
        self.conn_mode_label.pack(anchor="w", padx=16)
        
        self.conn_detail_label = tk.Label(conn_card, text="Waiting for connection...", 
                                          font=self.FONT_SMALL, fg=Theme.TEXT_MUTED, bg=Theme.BG_CARD)
        self.conn_detail_label.pack(anchor="w", padx=16, pady=(2, 16))
        
        # === Pairing Code Card ===
        pair_card = self._card(scroll_frame)
        pair_card.pack(fill="x", pady=(0, 8))
        
        tk.Label(pair_card, text="PAIRING CODE", font=(self.font_sans, 9, "bold"),
                fg=Theme.TEXT_MUTED, bg=Theme.BG_CARD).pack(anchor="w", padx=16, pady=(16, 8))
        
        self.pairing_label = tk.Label(pair_card, text="------", font=self.FONT_BIG_NUMBER,
                                      fg=Theme.ACCENT, bg=Theme.BG_CARD)
        self.pairing_label.pack(anchor="w", padx=16)
        
        self.pairing_timer = tk.Label(pair_card, text="Generating...", font=self.FONT_SMALL,
                                      fg=Theme.TEXT_MUTED, bg=Theme.BG_CARD)
        self.pairing_timer.pack(anchor="w", padx=16, pady=(2, 16))
        
        # === System Metrics ===
        metrics_label = tk.Label(scroll_frame, text="SYSTEM", font=(self.font_sans, 9, "bold"),
                                fg=Theme.TEXT_MUTED, bg=Theme.BG)
        metrics_label.pack(anchor="w", pady=(12, 6))
        
        metrics_row = tk.Frame(scroll_frame, bg=Theme.BG)
        metrics_row.pack(fill="x", pady=(0, 8))
        metrics_row.columnconfigure(0, weight=1)
        metrics_row.columnconfigure(1, weight=1)
        
        # CPU card
        cpu_card = self._card(metrics_row)
        cpu_card.grid(row=0, column=0, sticky="nsew", padx=(0, 4))
        tk.Label(cpu_card, text="CPU", font=self.FONT_SMALL, fg=Theme.TEXT_MUTED, bg=Theme.BG_CARD).pack(anchor="w", padx=12, pady=(12, 0))
        self.cpu_label = tk.Label(cpu_card, text="0%", font=(self.font_mono, 22, "bold"),
                                  fg=Theme.CYAN, bg=Theme.BG_CARD)
        self.cpu_label.pack(anchor="w", padx=12)
        self.cpu_bar = self._progress_bar(cpu_card, Theme.CYAN)
        self.cpu_bar.pack(fill="x", padx=12, pady=(4, 12))
        
        # Memory card
        mem_card = self._card(metrics_row)
        mem_card.grid(row=0, column=1, sticky="nsew", padx=(4, 0))
        tk.Label(mem_card, text="MEMORY", font=self.FONT_SMALL, fg=Theme.TEXT_MUTED, bg=Theme.BG_CARD).pack(anchor="w", padx=12, pady=(12, 0))
        self.mem_label = tk.Label(mem_card, text="0%", font=(self.font_mono, 22, "bold"),
                                  fg=Theme.PURPLE, bg=Theme.BG_CARD)
        self.mem_label.pack(anchor="w", padx=12)
        self.mem_bar = self._progress_bar(mem_card, Theme.PURPLE)
        self.mem_bar.pack(fill="x", padx=12, pady=(4, 12))
        
        # === Volume & Brightness Row ===
        vol_row = tk.Frame(scroll_frame, bg=Theme.BG)
        vol_row.pack(fill="x", pady=(0, 8))
        vol_row.columnconfigure(0, weight=1)
        vol_row.columnconfigure(1, weight=1)
        
        vol_card = self._card(vol_row)
        vol_card.grid(row=0, column=0, sticky="nsew", padx=(0, 4))
        tk.Label(vol_card, text="🔊 VOLUME", font=self.FONT_SMALL, fg=Theme.TEXT_MUTED, bg=Theme.BG_CARD).pack(anchor="w", padx=12, pady=(12, 0))
        self.vol_label = tk.Label(vol_card, text="50%", font=(self.font_mono, 18, "bold"),
                                  fg=Theme.TEXT, bg=Theme.BG_CARD)
        self.vol_label.pack(anchor="w", padx=12, pady=(0, 12))
        
        bri_card = self._card(vol_row)
        bri_card.grid(row=0, column=1, sticky="nsew", padx=(4, 0))
        tk.Label(bri_card, text="☀ BRIGHTNESS", font=self.FONT_SMALL, fg=Theme.TEXT_MUTED, bg=Theme.BG_CARD).pack(anchor="w", padx=12, pady=(12, 0))
        self.bri_label = tk.Label(bri_card, text="50%", font=(self.font_mono, 18, "bold"),
                                  fg=Theme.ORANGE, bg=Theme.BG_CARD)
        self.bri_label.pack(anchor="w", padx=12, pady=(0, 12))
        
        # === Network Info ===
        net_card = self._card(scroll_frame)
        net_card.pack(fill="x", pady=(0, 8))
        
        tk.Label(net_card, text="NETWORK", font=(self.font_sans, 9, "bold"),
                fg=Theme.TEXT_MUTED, bg=Theme.BG_CARD).pack(anchor="w", padx=16, pady=(16, 8))
        
        self.ip_label = tk.Label(net_card, text="Detecting...", font=self.FONT_MONO,
                                 fg=Theme.TEXT, bg=Theme.BG_CARD)
        self.ip_label.pack(anchor="w", padx=16)
        
        self.p2p_label = tk.Label(net_card, text="P2P: Port 9876", font=self.FONT_MONO_SMALL,
                                  fg=Theme.TEXT_MUTED, bg=Theme.BG_CARD)
        self.p2p_label.pack(anchor="w", padx=16, pady=(2, 16))
        
        # === Stats Row ===
        stats_card = self._card(scroll_frame)
        stats_card.pack(fill="x", pady=(0, 8))
        
        stats_inner = tk.Frame(stats_card, bg=Theme.BG_CARD)
        stats_inner.pack(fill="x", padx=16, pady=16)
        stats_inner.columnconfigure(0, weight=1)
        stats_inner.columnconfigure(1, weight=1)
        stats_inner.columnconfigure(2, weight=1)
        
        # Uptime
        tk.Label(stats_inner, text="UPTIME", font=self.FONT_SMALL, fg=Theme.TEXT_MUTED, bg=Theme.BG_CARD).grid(row=0, column=0, sticky="w")
        self.uptime_label = tk.Label(stats_inner, text="0:00:00", font=self.FONT_MONO,
                                     fg=Theme.TEXT, bg=Theme.BG_CARD)
        self.uptime_label.grid(row=1, column=0, sticky="w")
        
        # Commands
        tk.Label(stats_inner, text="COMMANDS", font=self.FONT_SMALL, fg=Theme.TEXT_MUTED, bg=Theme.BG_CARD).grid(row=0, column=1, sticky="w")
        self.cmd_count_label = tk.Label(stats_inner, text="0", font=self.FONT_MONO,
                                        fg=Theme.SUCCESS, bg=Theme.BG_CARD)
        self.cmd_count_label.grid(row=1, column=1, sticky="w")
        
        # P2P Clients
        tk.Label(stats_inner, text="P2P CLIENTS", font=self.FONT_SMALL, fg=Theme.TEXT_MUTED, bg=Theme.BG_CARD).grid(row=0, column=2, sticky="w")
        self.p2p_clients_label = tk.Label(stats_inner, text="0", font=self.FONT_MONO,
                                          fg=Theme.CYAN, bg=Theme.BG_CARD)
        self.p2p_clients_label.grid(row=1, column=2, sticky="w")
    
    def _build_logs_tab(self):
        """Logs tab with filterable, color-coded log entries."""
        frame = tk.Frame(self.content, bg=Theme.BG)
        self.tab_frames["logs"] = frame
        
        # Header
        header = tk.Frame(frame, bg=Theme.BG)
        header.pack(fill="x", pady=(0, 8))
        
        tk.Label(header, text="ACTIVITY LOG", font=(self.font_sans, 9, "bold"),
                fg=Theme.TEXT_MUTED, bg=Theme.BG).pack(side="left")
        
        clear_btn = tk.Label(header, text="Clear", font=self.FONT_SMALL,
                            fg=Theme.ACCENT, bg=Theme.BG, cursor="hand2")
        clear_btn.pack(side="right")
        clear_btn.bind("<Button-1>", lambda e: self._clear_logs())
        
        # Log list
        log_container = self._card(frame)
        log_container.pack(fill="both", expand=True)
        
        self.log_text = tk.Text(log_container, bg=Theme.BG_CARD, fg=Theme.TEXT,
                               font=self.FONT_MONO_SMALL, wrap="word", bd=0,
                               highlightthickness=0, padx=12, pady=12,
                               insertbackground=Theme.TEXT, selectbackground=Theme.ACCENT_DIM)
        self.log_text.pack(fill="both", expand=True)
        
        # Color tags
        self.log_text.tag_configure("error", foreground=Theme.ERROR)
        self.log_text.tag_configure("warn", foreground=Theme.WARNING)
        self.log_text.tag_configure("info", foreground=Theme.CYAN)
        self.log_text.tag_configure("time", foreground=Theme.TEXT_MUTED)
        self.log_text.tag_configure("category", foreground=Theme.PURPLE)
        self.log_text.configure(state="disabled")
    
    def _build_settings_tab(self):
        """Settings tab."""
        frame = tk.Frame(self.content, bg=Theme.BG)
        self.tab_frames["settings"] = frame
        
        # Device info card
        info_card = self._card(frame)
        info_card.pack(fill="x", pady=(0, 8))
        
        tk.Label(info_card, text="DEVICE", font=(self.font_sans, 9, "bold"),
                fg=Theme.TEXT_MUTED, bg=Theme.BG_CARD).pack(anchor="w", padx=16, pady=(16, 8))
        
        self.device_name_label = tk.Label(info_card, text=platform.node(), font=self.FONT_HEADING,
                                          fg=Theme.TEXT, bg=Theme.BG_CARD)
        self.device_name_label.pack(anchor="w", padx=16)
        
        tk.Label(info_card, text=f"{platform.system()} {platform.release()}", font=self.FONT_SMALL,
                fg=Theme.TEXT_MUTED, bg=Theme.BG_CARD).pack(anchor="w", padx=16, pady=(2, 16))
        
        # Actions
        actions_label = tk.Label(frame, text="ACTIONS", font=(self.font_sans, 9, "bold"),
                                fg=Theme.TEXT_MUTED, bg=Theme.BG)
        actions_label.pack(anchor="w", pady=(12, 6))
        
        # Open web app button
        self._action_button(frame, "🌐  Open Web App", self._open_web_app)
        
        # Ghost mode button
        self._action_button(frame, "👻  Enable Ghost Mode", self._toggle_ghost)
        
        # Restart agent button
        self._action_button(frame, "🔄  Restart Agent", self._restart_agent)
        
        # Quit button
        self._action_button(frame, "⏻  Quit Agent", self._quit, danger=True)
        
        # Spacer
        tk.Frame(frame, bg=Theme.BG, height=20).pack(fill="x")
        
        # Credits
        tk.Label(frame, text="JARVIS Agent v5.2.0", font=self.FONT_SMALL,
                fg=Theme.TEXT_MUTED, bg=Theme.BG).pack(anchor="center")
        tk.Label(frame, text="Total Black Edition", font=self.FONT_SMALL,
                fg=Theme.TEXT_MUTED, bg=Theme.BG).pack(anchor="center")
    
    # ============== UI HELPERS ==============
    
    def _card(self, parent) -> tk.Frame:
        """Create a glassmorphism-style card."""
        card = tk.Frame(parent, bg=Theme.BG_CARD, 
                       highlightbackground=Theme.BORDER, highlightthickness=1, bd=0)
        return card
    
    def _progress_bar(self, parent, color, height=4) -> tk.Canvas:
        """Create a minimal progress bar."""
        bar = tk.Canvas(parent, height=height, bg=Theme.BG_ELEVATED, 
                       highlightthickness=0, bd=0)
        bar._color = color
        bar._value = 0
        
        def _draw(val):
            bar.delete("all")
            w = bar.winfo_width()
            if w <= 1:
                w = 200
            fill_w = max(0, int(w * (val / 100.0)))
            bar.create_rectangle(0, 0, fill_w, height, fill=color, outline="")
            bar._value = val
        
        bar._draw = _draw
        bar.bind("<Configure>", lambda e: _draw(bar._value))
        return bar
    
    def _action_button(self, parent, text, command, danger=False):
        """Create a styled action button."""
        btn_frame = tk.Frame(parent, bg=Theme.BG_CARD, 
                            highlightbackground=Theme.BORDER if not danger else Theme.ERROR_DIM,
                            highlightthickness=1, bd=0, cursor="hand2")
        btn_frame.pack(fill="x", pady=(0, 4))
        
        btn_label = tk.Label(btn_frame, text=text, font=self.FONT_BODY,
                            fg=Theme.TEXT if not danger else Theme.ERROR,
                            bg=Theme.BG_CARD, anchor="w", padx=16, pady=10)
        btn_label.pack(fill="x")
        
        # Arrow
        arrow = tk.Label(btn_frame, text="›", font=(self.font_sans, 14),
                        fg=Theme.TEXT_MUTED, bg=Theme.BG_CARD)
        arrow.place(relx=1.0, rely=0.5, anchor="e", x=-12)
        
        # Hover effects
        def on_enter(e):
            btn_frame.configure(bg=Theme.BG_CARD_HOVER)
            btn_label.configure(bg=Theme.BG_CARD_HOVER)
            arrow.configure(bg=Theme.BG_CARD_HOVER, fg=Theme.TEXT)
        
        def on_leave(e):
            btn_frame.configure(bg=Theme.BG_CARD)
            btn_label.configure(bg=Theme.BG_CARD)
            arrow.configure(bg=Theme.BG_CARD, fg=Theme.TEXT_MUTED)
        
        for widget in [btn_frame, btn_label, arrow]:
            widget.bind("<Enter>", on_enter)
            widget.bind("<Leave>", on_leave)
            widget.bind("<Button-1>", lambda e: command())
    
    # ============== STATUS UPDATES ==============
    
    def update_status(self, data: Dict[str, Any]):
        """Thread-safe status update from agent."""
        self._status_data.update(data)
    
    def add_log(self, level: str, message: str, category: str = "general"):
        """Thread-safe log addition."""
        self._logs.append({
            "time": datetime.now().strftime("%H:%M:%S"),
            "level": level,
            "message": message,
            "category": category,
        })
        # Keep max 200 logs
        if len(self._logs) > 200:
            self._logs = self._logs[-200:]
    
    def _update_loop(self):
        """Periodic UI update from agent state."""
        try:
            self._refresh_ui()
        except Exception:
            pass
        self.root.after(1000, self._update_loop)
    
    def _refresh_ui(self):
        """Refresh all UI elements from current status data."""
        s = self._status_data
        
        # Try to get live data from agent
        if self.agent:
            try:
                from jarvis_agent import get_agent_status, get_logs, get_local_p2p_server
                status = get_agent_status()
                s.update({
                    "connected": status.get("connected", False),
                    "pairing_code": status.get("pairing_code", "------"),
                    "cpu": status.get("cpu_percent", 0),
                    "memory": status.get("memory_percent", 0),
                    "volume": status.get("volume", 50),
                    "brightness": status.get("brightness", 50),
                    "p2p_mode": status.get("connection_mode", "cloud"),
                    "local_ips": status.get("local_ips", []),
                    "device_name": status.get("device_name", platform.node()),
                })
                
                p2p = get_local_p2p_server()
                if p2p:
                    s["p2p_clients"] = len(p2p.clients)
                
                # Sync logs
                agent_logs = get_logs()
                for log in agent_logs[len(self._logs):]:
                    self._logs.append({
                        "time": log.get("timestamp", "")[:8] if "T" not in log.get("timestamp", "") else log.get("timestamp", "").split("T")[1][:8],
                        "level": log.get("level", "info"),
                        "message": log.get("message", ""),
                        "category": log.get("category", "general"),
                    })
            except Exception:
                pass
        else:
            # Demo/standalone - get live system info
            try:
                import psutil
                s["cpu"] = psutil.cpu_percent()
                s["memory"] = psutil.virtual_memory().percent
            except Exception:
                pass
        
        connected = s.get("connected", False)
        
        # Header
        self._draw_orb(connected)
        if connected:
            self.subtitle_label.configure(text=f"{s.get('device_name', '')} • Online")
            self.status_badge.configure(text="  ONLINE  ", fg=Theme.SUCCESS, bg=Theme.SUCCESS_DIM)
        else:
            self.subtitle_label.configure(text="Waiting for connection...")
            self.status_badge.configure(text="  OFFLINE  ", fg=Theme.ERROR, bg=Theme.ERROR_DIM)
        
        # Connection card
        self.conn_dot.set_color(Theme.SUCCESS if connected else Theme.ERROR)
        mode = s.get("p2p_mode", "cloud")
        if mode == "local_p2p":
            self.conn_mode_label.configure(text="Local P2P ⚡", fg=Theme.SUCCESS)
            self.conn_detail_label.configure(text="Ultra-low latency • Same network")
        elif connected:
            self.conn_mode_label.configure(text="Cloud Relay", fg=Theme.ACCENT)
            self.conn_detail_label.configure(text="Connected via cloud relay")
        else:
            self.conn_mode_label.configure(text="Disconnected", fg=Theme.TEXT_MUTED)
            self.conn_detail_label.configure(text="Waiting for mobile app to connect")
        
        # Pairing
        code = s.get("pairing_code", "------")
        if code and code != "------":
            self.pairing_label.configure(text=code)
        
        # Metrics
        cpu = int(s.get("cpu", 0))
        mem = int(s.get("memory", 0))
        self.cpu_label.configure(text=f"{cpu}%",
                                fg=Theme.ERROR if cpu > 80 else Theme.WARNING if cpu > 60 else Theme.CYAN)
        self.mem_label.configure(text=f"{mem}%",
                                fg=Theme.ERROR if mem > 80 else Theme.WARNING if mem > 60 else Theme.PURPLE)
        self.cpu_bar._draw(cpu)
        self.mem_bar._draw(mem)
        
        # Volume & Brightness
        self.vol_label.configure(text=f"{s.get('volume', 0)}%")
        self.bri_label.configure(text=f"{s.get('brightness', 0)}%")
        
        # Network
        ips = s.get("local_ips", [])
        self.ip_label.configure(text=ips[0] if ips else "No network")
        self.p2p_label.configure(text=f"P2P: ws://{'0.0.0.0'}:9876")
        
        # Uptime
        elapsed = int(time.time() - self._start_time)
        h, m, sec = elapsed // 3600, (elapsed % 3600) // 60, elapsed % 60
        self.uptime_label.configure(text=f"{h}:{m:02d}:{sec:02d}")
        
        # P2P clients
        self.p2p_clients_label.configure(text=str(s.get("p2p_clients", 0)))
        
        # Logs
        self._refresh_logs()
    
    def _refresh_logs(self):
        """Update log text widget."""
        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", "end")
        
        for log in reversed(self._logs[-50:]):
            t = log.get("time", "")
            level = log.get("level", "info")
            msg = log.get("message", "")
            cat = log.get("category", "")
            
            self.log_text.insert("end", f"{t} ", "time")
            self.log_text.insert("end", f"[{cat}] ", "category")
            self.log_text.insert("end", f"{msg}\n", level)
        
        self.log_text.configure(state="disabled")
    
    def _clear_logs(self):
        self._logs.clear()
        self._refresh_logs()
    
    # ============== ACTIONS ==============
    
    def _open_web_app(self):
        import webbrowser
        url = os.environ.get("JARVIS_APP_URL", "https://id-preview--f4290e42-0101-4af6-93cf-bf0d2c89db92.lovable.app")
        webbrowser.open(url)
    
    def _toggle_ghost(self):
        if self.agent:
            try:
                self.agent._enable_ghost_mode({})
            except Exception:
                pass
    
    def _restart_agent(self):
        if self.agent:
            self.agent.running = False
        self.root.after(1000, lambda: os.execv(sys.executable, [sys.executable] + sys.argv))
    
    def _quit(self):
        if self.agent:
            self.agent.running = False
        self.root.destroy()
        sys.exit(0)
    
    def run(self):
        """Start the GUI main loop."""
        self.root.mainloop()


def launch_gui(agent=None):
    """Launch the JARVIS GUI. Called from jarvis_agent.py or standalone."""
    gui = JarvisGUI(agent=agent)
    gui.run()


if __name__ == "__main__":
    # Standalone mode: launch GUI with demo data, or with agent
    import argparse
    parser = argparse.ArgumentParser(description="JARVIS Agent GUI")
    parser.add_argument("--standalone", action="store_true", help="Run GUI without agent")
    args = parser.parse_args()
    
    if args.standalone:
        launch_gui(agent=None)
    else:
        # Import and start agent in background thread
        try:
            from jarvis_agent import JarvisAgent
            agent = JarvisAgent()
            
            # Run agent in background
            agent_thread = threading.Thread(target=agent.run, daemon=True)
            agent_thread.start()
            
            # Launch GUI on main thread
            launch_gui(agent=agent)
        except ImportError:
            print("Could not import jarvis_agent. Running in standalone GUI mode.")
            launch_gui(agent=None)
