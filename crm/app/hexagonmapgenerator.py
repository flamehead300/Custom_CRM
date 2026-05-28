import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog
import math
import os
import json
import webbrowser
import platform
from datetime import datetime
from pathlib import Path

class KMLGeneratorApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Hexagon Grid KML Generator")
        self.root.geometry("550x800")
        
        # Set initial save directory
        default_path = str(Path.home() / "Downloads")
        
        # --- Variables ---
        self.save_dir = tk.StringVar(value=default_path)
        self.tessellate_var = tk.IntVar(value=1)  # 1 = True
        self.preview_var = tk.IntVar(value=1)     # 1 = True
        self.rings_var = tk.IntVar(value=0)       # 0 = single hex
        self.saved_locations = []
        
        # --- UI Layout ---
        self.create_widgets()
        self.load_saved_locations()
        
    def create_widgets(self):
        # Main container with scrolling capability if needed (simplified here)
        main_frame = ttk.Frame(self.root)
        main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        # Title
        title_label = tk.Label(main_frame, text="Hexagon Grid Generator", 
                               font=("Segoe UI", 16, "bold"), fg="#2c3e50")
        title_label.pack(pady=(0, 10))
        
        # Tabs
        notebook = ttk.Notebook(main_frame)
        notebook.pack(fill=tk.BOTH, expand=True)
        
        main_tab = ttk.Frame(notebook)
        notebook.add(main_tab, text="Main Settings")
        
        advanced_tab = ttk.Frame(notebook)
        notebook.add(advanced_tab, text="Saved Locations & Tools")
        
        self.create_main_tab(main_tab)
        self.create_advanced_tab(advanced_tab)
        
        # Status Bar
        self.status_bar = ttk.Label(self.root, text="Ready", relief=tk.SUNKEN, anchor=tk.W)
        self.status_bar.pack(side=tk.BOTTOM, fill=tk.X)
    
    def create_main_tab(self, parent):
        # -- File Settings --
        file_frame = ttk.LabelFrame(parent, text="File Configuration", padding=10)
        file_frame.pack(fill=tk.X, padx=5, pady=5)
        
        ttk.Label(file_frame, text="File Name:").grid(row=0, column=0, sticky=tk.W, pady=5)
        self.entry_filename = ttk.Entry(file_frame, width=35)
        self.entry_filename.grid(row=0, column=1, columnspan=2, pady=5, padx=5, sticky=tk.EW)
        self.entry_filename.insert(0, f"HexGrid_{datetime.now().strftime('%Y%m%d')}")
        
        ttk.Label(file_frame, text="Save To:").grid(row=1, column=0, sticky=tk.W, pady=5)
        ttk.Entry(file_frame, textvariable=self.save_dir, state="readonly").grid(row=1, column=1, pady=5, padx=5, sticky=tk.EW)
        ttk.Button(file_frame, text="Browse...", command=self.browse_directory).grid(row=1, column=2, padx=5)
        
        file_frame.columnconfigure(1, weight=1)

        # -- Geometry Settings --
        geo_frame = ttk.LabelFrame(parent, text="Geometry & Grid Configuration", padding=10)
        geo_frame.pack(fill=tk.X, padx=5, pady=10)
        
        self.create_geometry_grid(geo_frame)
        
        # -- Options --
        options_frame = ttk.LabelFrame(parent, text="Options", padding=10)
        options_frame.pack(fill=tk.X, padx=5, pady=5)
        
        ttk.Checkbutton(options_frame, text="Enable Terrain Clamping (KML tessellate)", 
                        variable=self.tessellate_var).pack(anchor=tk.W)
        
        ttk.Checkbutton(options_frame, text="Show result folder after generation", 
                        variable=self.preview_var).pack(anchor=tk.W, pady=(5, 0))
        
        # -- Generate Button --
        btn_frame = ttk.Frame(parent)
        btn_frame.pack(fill=tk.X, pady=20)
        
        gen_btn = tk.Button(btn_frame, text="GENERATE KML GRID", command=self.generate_kml, 
                           bg="#27ae60", fg="white", font=("Segoe UI", 11, "bold"), 
                           height=2, cursor="hand2")
        gen_btn.pack(fill=tk.X, padx=5)
        
        self.root.bind('<Return>', lambda e: self.generate_kml())
    
    def create_geometry_grid(self, parent):
        # Lat/Lon
        ttk.Label(parent, text="Latitude:").grid(row=0, column=0, sticky=tk.W, pady=5)
        self.entry_lat = ttk.Entry(parent, width=20)
        self.entry_lat.grid(row=0, column=1, sticky=tk.W, pady=5, padx=5)
        self.entry_lat.insert(0, "37.7749")
        
        ttk.Label(parent, text="Longitude:").grid(row=1, column=0, sticky=tk.W, pady=5)
        self.entry_lon = ttk.Entry(parent, width=20)
        self.entry_lon.grid(row=1, column=1, sticky=tk.W, pady=5, padx=5)
        self.entry_lon.insert(0, "-122.4194")
        
        # Presets
        btn_frame = ttk.Frame(parent)
        btn_frame.grid(row=2, column=0, columnspan=3, pady=5, sticky=tk.W)
        ttk.Label(btn_frame, text="Presets:").pack(side=tk.LEFT, padx=(0, 5))
        presets = [("SFO", "37.7749", "-122.4194"), ("NYC", "40.7128", "-74.0060"), ("LDN", "51.5074", "-0.1278")]
        for name, lat, lon in presets:
            ttk.Button(btn_frame, text=name, width=6,
                      command=lambda l=lat, lo=lon: self.set_location(l, lo)).pack(side=tk.LEFT, padx=2)

        ttk.Separator(parent, orient='horizontal').grid(row=3, column=0, columnspan=3, sticky="ew", pady=10)
        
        # Size
        ttk.Label(parent, text="Size (mi):").grid(row=4, column=0, sticky=tk.W, pady=5)
        self.entry_size = ttk.Entry(parent, width=10)
        self.entry_size.grid(row=4, column=1, sticky=tk.W, pady=5, padx=5)
        self.entry_size.insert(0, "5")
        
        self.size_scale = ttk.Scale(parent, from_=0.1, to=50, orient=tk.HORIZONTAL,
                                   command=lambda v: self.update_entry_from_scale(self.entry_size, v))
        self.size_scale.set(5)
        self.size_scale.grid(row=5, column=0, columnspan=3, sticky=tk.EW, pady=(0, 5))
        
        # Rotation
        ttk.Label(parent, text="Rotation (°):").grid(row=6, column=0, sticky=tk.W, pady=5)
        self.entry_rotation = ttk.Entry(parent, width=10)
        self.entry_rotation.grid(row=6, column=1, sticky=tk.W, pady=5, padx=5)
        self.entry_rotation.insert(0, "0")
        
        self.rotation_scale = ttk.Scale(parent, from_=0, to=360, orient=tk.HORIZONTAL,
                                       command=lambda v: self.update_entry_from_scale(self.entry_rotation, v))
        self.rotation_scale.set(0)
        self.rotation_scale.grid(row=7, column=0, columnspan=3, sticky=tk.EW)

        # Rings (New Feature)
        ttk.Separator(parent, orient='horizontal').grid(row=8, column=0, columnspan=3, sticky="ew", pady=10)
        
        ttk.Label(parent, text="Grid Rings:").grid(row=9, column=0, sticky=tk.W, pady=5)
        
        # Spinbox for Rings (0-10)
        rings_spin = ttk.Spinbox(parent, from_=0, to=10, textvariable=self.rings_var, width=8)
        rings_spin.grid(row=9, column=1, sticky=tk.W, pady=5, padx=5)
        
        ttk.Label(parent, text="(0 = Single Hex)").grid(row=9, column=2, sticky=tk.W)

    def update_entry_from_scale(self, entry, value):
        entry.delete(0, tk.END)
        entry.insert(0, f"{float(value):.1f}")

    def create_advanced_tab(self, parent):
        # Saved Locations
        saved_frame = ttk.LabelFrame(parent, text="Saved Locations", padding=10)
        saved_frame.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        list_frame = ttk.Frame(saved_frame)
        list_frame.pack(fill=tk.BOTH, expand=True, pady=(0, 10))
        
        scrollbar = ttk.Scrollbar(list_frame)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        self.locations_listbox = tk.Listbox(list_frame, yscrollcommand=scrollbar.set, height=10)
        self.locations_listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.config(command=self.locations_listbox.yview)
        
        btn_frame = ttk.Frame(saved_frame)
        btn_frame.pack(fill=tk.X)
        
        ttk.Button(btn_frame, text="Save Current", command=self.save_current_location).pack(side=tk.LEFT, padx=2, expand=True, fill=tk.X)
        ttk.Button(btn_frame, text="Load Selected", command=self.load_selected_location).pack(side=tk.LEFT, padx=2, expand=True, fill=tk.X)
        ttk.Button(btn_frame, text="Delete", command=self.delete_location).pack(side=tk.LEFT, padx=2, expand=True, fill=tk.X)
        
        # Config Tools
        io_frame = ttk.LabelFrame(parent, text="Configuration", padding=10)
        io_frame.pack(fill=tk.X, padx=5, pady=5)
        ttk.Button(io_frame, text="Export Settings", command=self.export_settings).pack(side=tk.LEFT, padx=5, expand=True, fill=tk.X)
        ttk.Button(io_frame, text="Import Settings", command=self.import_settings).pack(side=tk.LEFT, padx=5, expand=True, fill=tk.X)
        
        ttk.Button(parent, text="Reset Defaults", command=self.reset_defaults).pack(pady=20)
    
    # --- Math Helpers ---

    def get_destination_point(self, lat1, lon1, bearing, distance_miles):
        """Standard Haversine destination calculation."""
        R = 3959.0  # Earth Radius in miles
        lat1_rad = math.radians(lat1)
        lon1_rad = math.radians(lon1)
        bearing_rad = math.radians(bearing)
        
        lat2_rad = math.asin(math.sin(lat1_rad) * math.cos(distance_miles / R) +
                             math.cos(lat1_rad) * math.sin(distance_miles / R) * math.cos(bearing_rad))
        
        lon2_rad = lon1_rad + math.atan2(math.sin(bearing_rad) * math.sin(distance_miles / R) * math.cos(lat1_rad),
                                         math.cos(distance_miles / R) - math.sin(lat1_rad) * math.sin(lat2_rad))
        
        return math.degrees(lat2_rad), math.degrees(lon2_rad)

    def axial_ring_coords(self, rings):
        """Generate (q,r) axial coordinates for all hexes in N rings."""
        coords = []
        for q in range(-rings, rings + 1):
            r1 = max(-rings, -q - rings)
            r2 = min(rings, -q + rings)
            for r in range(r1, r2 + 1):
                coords.append((q, r))
        return coords

    def axial_to_geo_offset(self, q, r, radius_miles, rotation_deg):
        """
        Convert axial (q,r) to a bearing and distance from center.
        Includes grid rotation so the honeycomb structure rotates with the hexes.
        """
        # Standard Pointy-Top Hex conversion to cartesian offsets
        # dx = width between columns = sqrt(3) * R
        # dy = vertical distance = 1.5 * R
        
        # Initial Cartesian offsets (before rotation)
        # x points East, y points North
        x_base = math.sqrt(3) * radius_miles * (q + r / 2.0)
        y_base = 1.5 * radius_miles * r
        
        # Convert Cartesian to Polar (Distance + Angle)
        dist = math.sqrt(x_base**2 + y_base**2)
        if dist == 0:
            return 0, 0
            
        # Angle in degrees (Math uses counter-clockwise from X-axis. Geo uses Clockwise from North)
        # We'll stick to standard trig first: 0 is East, 90 is North.
        base_angle_rad = math.atan2(y_base, x_base)
        base_angle_deg = math.degrees(base_angle_rad)
        
        # Convert trig angle (0=East, CCW) to Compass Bearing (0=North, CW)
        # Compass = 90 - Trig
        bearing = 90 - base_angle_deg
        
        # Apply the user's rotation to the GRID as well
        # If user rotates hexes 30 deg, we rotate the center bearing 30 deg
        final_bearing = bearing + rotation_deg
        
        return final_bearing, dist

    def generate_hex_polygon(self, c_lat, c_lon, radius_miles, rotation_deg):
        """Generate vertices for a single hexagon at c_lat, c_lon."""
        coords = []
        for i in range(7):
            # Vertex 0 is normally North (0 deg) for Pointy Top
            angle = (i * 60.0) + rotation_deg
            lat, lon = self.get_destination_point(c_lat, c_lon, angle, radius_miles)
            coords.append(f"{lon:.6f},{lat:.6f},0")
        return "\n".join(coords)

    # --- Core Logic ---

    def generate_kml(self):
        if not self.save_dir.get():
            messagebox.showerror("Error", "Please select a save location.")
            return
        
        try:
            filename = self.entry_filename.get().strip()
            if not filename: raise ValueError("Filename cannot be empty")
            
            c_lat = float(self.entry_lat.get())
            c_lon = float(self.entry_lon.get())
            size = float(self.entry_size.get())
            rot = float(self.entry_rotation.get())
            rings = int(self.rings_var.get())
            tess = bool(self.tessellate_var.get())
            
            if size <= 0: raise ValueError("Size must be positive")
            if rings < 0: raise ValueError("Rings cannot be negative")
            
        except ValueError as e:
            messagebox.showerror("Input Error", f"Invalid input: {e}")
            return
        
        # 1. Setup Geometry
        radius_miles = size / math.sqrt(3) # flat-to-flat -> circumradius
        
        # 2. Generate Grid Centers
        grid_coords = self.axial_ring_coords(rings)
        
        # 3. Build Placemarks
        placemarks = []
        tess_tag = "<tessellate>1</tessellate>" if tess else "<tessellate>0</tessellate>"
        
        for q, r in grid_coords:
            # Find center of this specific hex
            # We apply rotation here so the grid rotates with the shapes
            bearing, dist = self.axial_to_geo_offset(q, r, radius_miles, rot)
            
            # Calculate actual Lat/Lon for this hex center
            hex_lat, hex_lon = self.get_destination_point(c_lat, c_lon, bearing, dist)
            
            # Generate the polygon vertices
            poly_str = self.generate_hex_polygon(hex_lat, hex_lon, radius_miles, rot)
            
            placemarks.append(f"""
    <Placemark>
      <name>Hex ({q}, {r})</name>
      <Style>
        <LineStyle><width>2</width><color>ff0000ff</color></LineStyle>
        <PolyStyle><fill>0</fill></PolyStyle>
      </Style>
      <Polygon>
        {tess_tag}
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
{poly_str}
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>""")

        # 4. Assemble KML
        total_hexes = len(placemarks)
        kml_body = "\n".join(placemarks)
        
        kml_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>{filename}</name>
    <Placemark>
      <name>Grid Center</name>
      <Point><coordinates>{c_lon:.6f},{c_lat:.6f},0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>Grid Metadata</name>
      <description>
        <![CDATA[
          <b>Center:</b> {c_lat:.6f}, {c_lon:.6f}<br/>
          <b>Size:</b> {size} miles (flat-to-flat)<br/>
          <b>Rotation:</b> {rot}°<br/>
          <b>Rings:</b> {rings}<br/>
          <b>Total Hexes:</b> {total_hexes}<br/>
          <b>Generated:</b> {datetime.now()}
        ]]>
      </description>
    </Placemark>
{kml_body}
  </Document>
</kml>"""

        # 5. Save
        full_path = os.path.join(self.save_dir.get(), f"{filename}.kml")
        try:
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(kml_content)
            
            self.status_bar.config(text=f"Success! Saved {filename}.kml with {total_hexes} hexes.")
            
            if self.preview_var.get():
                if messagebox.askyesno("Success", f"Generated {total_hexes} hexagons.\nSaved to:\n{full_path}\n\nOpen containing folder?"):
                    self.open_folder()
            else:
                messagebox.showinfo("Success", f"Generated {total_hexes} hexagons.\nSaved to:\n{full_path}")
                
        except Exception as e:
            messagebox.showerror("File Error", str(e))

    # --- Utility ---
    def browse_directory(self):
        directory = filedialog.askdirectory(initialdir=self.save_dir.get())
        if directory:
            self.save_dir.set(directory)

    def open_folder(self):
        path = self.save_dir.get()
        if platform.system() == "Windows": os.startfile(path)
        elif platform.system() == "Darwin": os.system(f'open "{path}"')
        else: os.system(f'xdg-open "{path}"')

    def set_location(self, lat, lon):
        self.entry_lat.delete(0, tk.END)
        self.entry_lat.insert(0, lat)
        self.entry_lon.delete(0, tk.END)
        self.entry_lon.insert(0, lon)

    # --- Saved Locations ---
    def load_saved_locations(self):
        try:
            if os.path.exists('saved_locations.json'):
                with open('saved_locations.json', 'r') as f:
                    self.saved_locations = json.load(f)
                self.refresh_locations_list()
        except: self.saved_locations = []

    def refresh_locations_list(self):
        self.locations_listbox.delete(0, tk.END)
        for loc in self.saved_locations:
            self.locations_listbox.insert(tk.END, f"{loc['name']}")

    def save_current_location(self):
        name = simpledialog.askstring("Save", "Name this location:")
        if name:
            self.saved_locations.append({'name': name, 'lat': self.entry_lat.get(), 'lon': self.entry_lon.get()})
            self.save_locations_file()
            self.refresh_locations_list()

    def save_locations_file(self):
        with open('saved_locations.json', 'w') as f: json.dump(self.saved_locations, f)

    def load_selected_location(self):
        sel = self.locations_listbox.curselection()
        if sel:
            loc = self.saved_locations[sel[0]]
            self.set_location(loc['lat'], loc['lon'])

    def delete_location(self):
        sel = self.locations_listbox.curselection()
        if sel:
            del self.saved_locations[sel[0]]
            self.save_locations_file()
            self.refresh_locations_list()

    def export_settings(self):
        path = filedialog.asksaveasfilename(defaultextension=".json", filetypes=[("JSON", "*.json")])
        if path:
            data = {
                'lat': self.entry_lat.get(), 'lon': self.entry_lon.get(),
                'size': self.entry_size.get(), 'rot': self.entry_rotation.get(),
                'rings': self.rings_var.get()
            }
            with open(path, 'w') as f: json.dump(data, f)

    def import_settings(self):
        path = filedialog.askopenfilename(filetypes=[("JSON", "*.json")])
        if path:
            with open(path, 'r') as f: data = json.load(f)
            self.set_location(data.get('lat'), data.get('lon'))
            self.update_entry_from_scale(self.entry_size, data.get('size', 5))
            self.update_entry_from_scale(self.entry_rotation, data.get('rot', 0))
            self.rings_var.set(data.get('rings', 0))

    def reset_defaults(self):
        self.set_location("37.7749", "-122.4194")
        self.entry_size.delete(0, tk.END); self.entry_size.insert(0, "5")
        self.entry_rotation.delete(0, tk.END); self.entry_rotation.insert(0, "0")
        self.rings_var.set(0)

if __name__ == "__main__":
    root = tk.Tk()
    # Center window
    w, h = 550, 800
    ws, hs = root.winfo_screenwidth(), root.winfo_screenheight()
    x, y = (ws/2) - (w/2), (hs/2) - (h/2)
    root.geometry(f'{w}x{h}+{int(x)}+{int(y)}')
    
    app = KMLGeneratorApp(root)
    root.mainloop()