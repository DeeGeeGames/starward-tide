"""Run in Blender. Creates an isolated sample scene; leaves other scenes intact."""
import bpy
import math
import json
from pathlib import Path
from mathutils import Vector

OUT = Path(__file__).resolve().parent
OUT.mkdir(parents=True, exist_ok=True)
scene = bpy.data.scenes.new('GC • Narrower warship v3')
bpy.context.window.scene = scene
ship = bpy.data.collections.new('Warship')
scene.collection.children.link(ship)
studio = bpy.data.collections.new('Studio')
scene.collection.children.link(studio)

def material(name, color, metallic=0.0, roughness=0.4, emission=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    p = mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = roughness
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    return mat

armor = material('Hull • blue graphite', (.055,.11,.155), .65, .43)
plate = material('Armor • desaturated steel', (.24,.36,.43), .68, .46)
edge = material('Edge • pale titanium', (.44,.57,.63), .72, .3)
dark = material('Recess • charcoal', (.012,.023,.032), .35, .5)
cyan = material('Faction • cyan enamel', (.035,.57,.76), .48, .28)
light = material('Windows • ice blue', (.2,.8,1), .15, .24, 2.5)
engine = material('Drive • plasma', (.1,.65,1), .1, .25, 4)
warning = material('Safety • ochre', (.95,.45,.09), .3, .4)

parts = []
def finish(obj, name, mat, bevel=0):
    obj.name = name
    for col in list(obj.users_collection): col.objects.unlink(obj)
    ship.objects.link(obj)
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new('Machined armor edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        mod = obj.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
    parts.append(obj)
    return obj

def box(name, xyz, size, mat, bevel=.06):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz)
    obj=bpy.context.object
    obj.scale=size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj,name,mat,bevel)

def prism(name, points, bottom, top, mat, bevel=.08):
    n=len(points)
    verts=[(x,y,z) for z in [bottom,top] for x,y in points]
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(verts,[],faces)
    mesh.update()
    obj=bpy.data.objects.new(name,mesh)
    ship.objects.link(obj)
    return finish(obj,name,mat,bevel)

def cylinder(name, pos, radius, depth, mat, axis='Z', vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=pos)
    obj=bpy.context.object
    if axis=='X': obj.rotation_euler[1]=math.pi/2
    if axis=='Y': obj.rotation_euler[0]=math.pi/2
    return finish(obj,name,mat,.035)

# Longitudinal hull sections retain the broad plan but add a rounded, deep body.
# Each cross-section is a softly squared oval, not an extruded top silhouette.
stations=[(-13.0,2.9,.76),(-12.5,3.8,.9),(-10.5,4.9,1),(-8,5.5,1.02),(-6,6.8,1.04),(-3,7,1.04),(0,7,1.04),(3,6.7,1.02),(6,5.5,.96),(9,4.2,.83),(11.5,2.1,.62),(12,1.3,.48)]
segments=48

def section(x,width,height,theta,offset=0):
    c,sn=math.cos(theta),math.sin(theta)
    y=math.copysign(abs(c)**.78,c)*(width+offset)
    z=-.8+math.copysign(abs(sn)**.82,sn)*(4.4*height+offset)
    return (x,y,z)

def shell(name, rows, angles, mat, offset=0, closed=False):
    verts=[section(x,w,h,a,offset) for x,w,h in rows for a in angles]
    n=len(angles)
    faces=[]
    for i in range(len(rows)-1):
        for j in range(n if closed else n-1):
            j2=(j+1)%n
            faces.append((i*n+j,i*n+j2,(i+1)*n+j2,(i+1)*n+j))
    if closed:
        faces += [tuple(reversed(range(n))),tuple((len(rows)-1)*n+j for j in range(n))]
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(verts,[],faces); mesh.update()
    obj=bpy.data.objects.new(name,mesh); ship.objects.link(obj)
    finish(obj,name,mat)
    for poly in mesh.polygons: poly.use_smooth=len(poly.vertices)==4
    return obj

shell('Hull / rounded pressure body',stations,[2*math.pi*j/segments for j in range(segments)],armor,closed=True)
# Armor follows the curve over the shoulders and under the belly. Narrow gaps
# between longitudinal blocks and angular courses expose the darker inner hull.
for i in range(len(stations)-1):
    a,b=stations[i:i+2]
    gap=.045
    rows=[tuple(a[k]+(b[k]-a[k])*t for k in range(3)) for t in [gap,.5,1-gap]]
    for j,(lo,hi) in enumerate([(5,40),(42,73),(75,105),(107,138),(140,175),(185,222),(224,256),(258,282),(284,316),(318,355)]):
        angles=[math.radians(lo+(hi-lo)*t/6) for t in range(7)]
        panel=shell('Hull armor / curved course %02d.%02d'%(i,j),rows,angles,plate if j<5 else armor,.075)
        mod=panel.modifiers.new('Armor thickness','SOLIDIFY');mod.thickness=.09
# Equatorial trenches expose deck-height detail on both sides.
for side in [-1,1]:
    for x in [-5,-3.5,-2,-.5,1,2.5]:
        box('Hull / inset service light',(x,side*7.015,-.8),(.36,.035,.095),light,.01)
        box('Hull / recessed bay',(x,side*6.92,-1.15),(.9,.12,.3),dark,.03)
    # Small broadside modules and lower lights break up the deep flank.
    for x in [-4,0,3]:
        box('Broadside / armored blister',(x,side*6.4,-2.4),(1.6,1.1,1.1),armor,.24)
        box('Broadside / inset',(x+.86,side*6.4,-2.4),(.08,.55,.4),dark,.04)
    # Faction marks lie across the upper curved shoulder.
    stripe_rows=[(-5.7,6.82,1.04),(-3,7,1.04),(0,7,1.04),(2.7,6.73,1.02)]
    lo,hi=(49,54) if side==1 else (126,131)
    shell('Faction / curved shoulder stripe',stripe_rows,[math.radians(v) for v in range(lo,hi+1)],cyan,.18)
    for x in [-10,-9.2,-8.4]:
        box('Engineering / dorsal vent',(x,side*2.1,3.25),(.35,1.5,.16),dark,.025)
# A raised dorsal platform ties the batteries into the rounded hull.
prism('Dorsal / armored spine',[(-10,-1.65),(8.5,-1.65),(10,-.9),(10,.9),(8.5,1.65),(-10,1.65)],3.1,3.8,armor,.22)
prism('Ventral / heavy keel',[(-9,-1.5),(7,-1.5),(9,0),(7,1.5),(-9,1.5)],-5.8,-4.8,armor,.25)

# Low, protected central command citadel; no fighter cockpit or carrier runway.
prism('Citadel / foundation',[(-3,-2.5),(3.3,-2.5),(4.2,-1.5),(4.2,1.5),(3.3,2.5),(-3,2.5)],1.9,2.8,armor,.18)
prism('Citadel / armored command deck',[(-2.6,-1.9),(1.8,-1.9),(2.7,-1),(2.7,1),(1.8,1.9),(-2.6,1.9)],2.8,3.7,plate,.14)
box('Bridge / forward glass slit',(2.73,0,3.36),(.05,1.8,.18),light,.01)
for side in [-1,1]:
    for x in [-2,-1.4,-.8,-.2,.4,1]:
        box('Bridge / armored window',(x,side*1.92,3.34),(.32,.035,.14),light,.008)
    box('Citadel / roof rail',(-.5,side*1.35,3.83),(3.7,.2,.2),edge)
box('Citadel / central spine',(-.6,0,3.91),(3.6,1.35,.4),armor,.12)
box('Sensors / mast',(-1.3,0,4.48),(.38,.38,.9),edge)
box('Sensors / cross array',(-1.3,0,4.91),(.4,2.4,.18),armor)
for y in [-1,1]: box('Sensors / emitter',(-1.3,y,5.04),(.25,.25,.18),cyan,.02)

# Original forward and aft twin cannon mounts, enlarged as capital batteries.
def turret(x,direction,label):
    cylinder(label+' / barbette',(x,0,2.16),1.8,.42,dark,vertices=24)
    cylinder(label+' / traverse ring',(x,0,2.44),1.58,.3,edge,vertices=24)
    points=[(-1.45,-1.3),(.95,-1.3),(1.5,-.85),(1.5,.85),(.95,1.3),(-1.45,1.3)]
    points=[(x+direction*a,direction*b) for a,b in points]
    prism(label+' / turret armor',points,2.57,3.43,armor,.13)
    box(label+' / roof armor',(x-.15*direction,0,3.46),(1.9,2.1,.16),plate)
    box(label+' / faction marking',(x-.35*direction,0,3.56),(1.35,.32,.04),cyan,.012)
    for y in [-.53,.53]:
        cylinder(label+' / gun cradle',(x+direction*1.25,y,2.98),.29,1.25,edge,'X')
        cylinder(label+' / barrel',(x+direction*2.55,y,2.98),.17,2.65,armor,'X')
        cylinder(label+' / muzzle sleeve',(x+direction*3.8,y,2.98),.23,.55,plate,'X')
        cylinder(label+' / muzzle recess',(x+direction*4.085,y,2.98),.145,.025,dark,'X')
turret(5.5,1,'Battery A')
turret(-5.5,-1,'Battery B')
# Four small point-defense blisters emphasize scale without changing the core silhouette.
for x in [-3.8,2]:
    for side in [-1,1]:
        cylinder('Point defense / base',(x,side*4,2.64),.52,.25,dark)
        box('Point defense / housing',(x,side*4,2.94),(.8,.72,.44),armor)
        for dy in [-.15,.15]: cylinder('Point defense / barrel',(x+.65,side*4+dy,2.98),.065,.8,edge,'X',8)

for y in [-2,2]:
    cylinder('Drive / armored collar',(-12.45,y,-.05),1.12,1.45,armor,'X',24)
    cylinder('Drive / outer rim',(-13.2,y,-.05),.96,.3,edge,'X',24)
    cylinder('Drive / dark throat',(-13.38,y,-.05),.8,.08,dark,'X',24)
    cylinder('Drive / luminous core',(-13.44,y,-.05),.64,.03,engine,'X',24)
    cylinder('Drive / central plug',(-13.47,y,-.05),.23,.05,edge,'X',16)
    for angle in range(0,360,90):
        a=math.radians(angle)
        box('Drive / cooling rib',(-12.4,y+math.cos(a)*1.05,-.05+math.sin(a)*1.05),(1.15,.15,.15),plate,.025)
# Blunt layered prow with a cyan centerline identifier.
# Rounded prow needs no flat glacis overlay.
box('Prow / insignia',(10.4,0,2.28),(1.5,.55,.05),cyan,.02)
for side in [-1,1]:
    box('Prow / hazard inset',(11.94,side*.85,.25),(.06,.35,.6),warning,.02)

# Raise the original upper works above the rounded hull.
for obj in parts:
    if obj.name.startswith(('Citadel /','Bridge /','Sensors /')):
        obj.location.z += 3.0
    elif obj.name.startswith(('Battery A','Battery B')):
        obj.location.z += 1.85
    elif obj.name.startswith('Point defense /'):
        obj.location.z += .48
    elif obj.name.startswith('Prow /'):
        obj.location.z += .35
    elif obj.name.startswith('Drive /'):
        obj.location.z -= .75
# Tiered citadel supports replace the low platform and add central vertical mass.
prism('Citadel support / lower',[(-3.8,-2.8),(2.5,-2.8),(3.6,-1.7),(3.6,1.7),(2.5,2.8),(-3.8,2.8)],3.25,4.3,armor,.25)
prism('Citadel support / upper',[(-3.3,-2.45),(2.7,-2.45),(3.6,-1.4),(3.6,1.4),(2.7,2.45),(-3.3,2.45)],4.3,5.1,plate,.2)
for side in [-1,1]:
    for x in [-2.7,-1.9,-1.1,-.3,.5,1.3]:
        box('Citadel support / service light',(x,side*2.48,4.65),(.3,.035,.1),light,.01)

# Taper the dorsal spine down into the bow instead of leaving a deck overhang.
for obj in parts:
    if obj.name.startswith('Dorsal / armored spine'):
        for vertex in obj.data.vertices:
            if vertex.co.x > 7:
                vertex.co.z -= (vertex.co.x-7)*.48

# Bake modifiers and consolidate static surfaces per material for a lightweight GLB.
for obj in parts:
    bpy.context.view_layer.objects.active=obj
    obj.select_set(True)
    for modifier in list(obj.modifiers): bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.data.set_sharp_from_angle(angle=math.radians(30))
    obj.select_set(False)
# Reduce beam by 16 percent; preserve height, length and circular gun/drive parts.
# Adjust hardware mounting positions to follow the narrower armor.
for obj in parts:
    obj.location.y *= .84
    if not obj.name.startswith(('Battery A','Battery B','Point defense /','Drive /','Sensors /')):
        for vertex in obj.data.vertices:
            vertex.co.y *= .84

# Keep the editable assembly in the .blend; exporter is given this hierarchy.
root=bpy.data.objects.new('GC_Warship',None)
ship.objects.link(root)
root['description']='Normal warship v3: rounded volumetric hull inspired by src/ship-art.ts'
root['forward_axis']='+X (Blender); +X in glTF'
root['nominal_length_m']=260
for obj in parts: obj.parent=root
root['scale_note']='Model uses design units, approximately 10 meters per unit; visual scale is provisional.'

world=bpy.data.worlds.new('Deep navy studio')
world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.018,.028,.048,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.5
scene.world=world

def aim(obj,target): obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
def area(name,xyz,power,color,size):
    data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.color=color; data.shape='DISK'; data.size=size
    obj=bpy.data.objects.new(name,data); studio.objects.link(obj); obj.location=xyz; aim(obj,(0,0,0))
area('Key / soft daylight',(8,-10,22),4200,(.76,.9,1),14)
area('Rim / cyan',(-12,10,14),5000,(.25,.65,1),12)
area('Fill / warm',(15,12,8),2600,(1,.78,.56),10)
area('Hull fill',(0,-18,1),1800,(.45,.67,1),12)
camdata=bpy.data.cameras.new('Isometric camera')
cam=bpy.data.objects.new('Isometric camera',camdata); studio.objects.link(cam)
camdata.type='ORTHO'; camdata.ortho_scale=37
cam.location=(32,-40,31); aim(cam,(0,0,.5)); scene.camera=cam
scene.render.engine='CYCLES'
scene.cycles.samples=48
scene.cycles.use_denoising=True
scene.render.resolution_x=1500; scene.render.resolution_y=1050; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.view_settings.view_transform='AgX'
scene.render.film_transparent=False
# Store asset plus presentation scene without changing the open document's filepath.
bpy.data.libraries.write(str(OUT/'capital-warship.blend'),{scene},fake_user=True)
bpy.ops.object.select_all(action='DESELECT')
for obj in parts+[root]: obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'capital-warship.raw.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_apply=True,export_yup=True,export_cameras=False,export_lights=False)
triangles=sum(len(p.vertices)-2 for obj in parts for p in obj.data.polygons)
(OUT/'asset-report.json').write_text(json.dumps({'source':'src/ship-art.ts:WARSHIP_HULL','mesh_objects':len(parts),'triangles':triangles,'materials':8,'pivot':'center of hull','forward':'+X','up':'glTF +Y; Blender +Z','length_design_units':25.495,'revision':'v3 narrower hull','hull_width_factor':0.84,'intended_scale':'approx 260 m; provisional','status':'visual experiment; no runtime integration or LOD'},indent=2))
scene.render.filepath=str(OUT/'isometric.png')
bpy.ops.render.render(write_still=True)
cam.location=(-34,-38,27); aim(cam,(0,0,.5))
scene.render.filepath=str(OUT/'aft.png')
bpy.ops.render.render(write_still=True)
cam.location=(0,-45,2); aim(cam,(0,0,.5)); camdata.ortho_scale=33
scene.render.filepath=str(OUT/'profile.png')
bpy.ops.render.render(write_still=True)
cam.location=(32,-40,31); aim(cam,(0,0,.5)); camdata.ortho_scale=37
# Leave the sample available in Blender, with a useful material viewport.
for screen in bpy.data.screens:
    for area_view in screen.areas:
        if area_view.type=='VIEW_3D':
            area_view.spaces.active.region_3d.view_perspective='CAMERA'
            area_view.spaces.active.shading.type='MATERIAL'
result={'scene':scene.name,'triangles':triangles,'parts':len(parts),'output':str(OUT)}
