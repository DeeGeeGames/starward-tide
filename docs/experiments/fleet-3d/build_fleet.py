"""Blender authoring script for three low-poly fleet studies. Existing scenes preserved."""
import bpy
import math
import json
from pathlib import Path
from mathutils import Vector

OUT=Path(__file__).resolve().parent
OUT.mkdir(parents=True,exist_ok=True)

def material(name,color,metal=.5,rough=.45,emission=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    if emission:
        p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
    return m

armor=material('Hull_Graphite',(.055,.11,.155))
plate=material('Armor_Steel',(.24,.36,.43))
edge=material('Trim_Titanium',(.44,.57,.63))
dark=material('Recess',(.012,.023,.032),.2,.6)
cyan=material('Faction_Accent',(.035,.57,.76))
light=material('Drive_And_Windows',(.18,.72,1),.1,.3,2)
materials=[armor,plate,edge,dark,cyan,light]
parts=[]
scene=None
asset_collection=None

def finish(obj,name,mat,bevel=0):
    obj.name=name
    for col in list(obj.users_collection):col.objects.unlink(obj)
    asset_collection.objects.link(obj);obj.data.materials.append(mat)
    if bevel:
        mod=obj.modifiers.new('Single segment armor chamfer','BEVEL');mod.width=bevel;mod.segments=1
        mod=obj.modifiers.new('Weighted normals','WEIGHTED_NORMAL');mod.keep_sharp=True
    parts.append(obj)
    return obj

def box(name,pos,size,mat,bevel=.08):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos)
    obj=bpy.context.object;obj.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(obj,name,mat,bevel)

def cyl(name,pos,radius,depth,mat,axis='Z',vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=pos)
    obj=bpy.context.object
    if axis=='X':obj.rotation_euler[1]=math.pi/2
    if axis=='Y':obj.rotation_euler[0]=math.pi/2
    return finish(obj,name,mat)

def hull(name,stations,center_y,center_z,mat):
    # Eight-point chamfered cross sections: clear volume with a small face budget.
    section=[(1,.55),(.62,1),(-.62,1),(-1,.55),(-1,-.55),(-.62,-1),(.62,-1),(1,-.55)]
    verts=[(x,center_y+w*y,center_z+h*z) for x,w,h in stations for y,z in section]
    faces=[tuple(reversed(range(8))),tuple((len(stations)-1)*8+j for j in range(8))]
    for i in range(len(stations)-1):
        for j in range(8):faces.append((i*8+j,i*8+(j+1)%8,(i+1)*8+(j+1)%8,(i+1)*8+j))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);asset_collection.objects.link(obj)
    return finish(obj,name,mat)

def windows(x,y,z,count=4,spacing=.65):
    for i in range(count):box('Bridge / window',(x+i*spacing,y,z),(.3,.03,.12),light,0)

def drive(x,y,z,r):
    cyl('Drive / shroud',(x,y,z),r,.9,armor,'X')
    cyl('Drive / rim',(x-.48,y,z),r*.83,.12,edge,'X')
    cyl('Drive / recess',(x-.56,y,z),r*.68,.06,dark,'X')
    cyl('Drive / plasma',(x-.60,y,z),r*.48,.025,light,'X')

def turret(x,y,z,scale=1):
    cyl('Defense / mount',(x,y,z),.65*scale,.28*scale,dark)
    box('Defense / turret',(x,y,z+.3*scale),(1.25*scale,1.05*scale,.55*scale),plate,.12*scale)
    for side in [-1,1]:cyl('Defense / barrel',(x+.85*scale,y+side*.22*scale,z+.32*scale),.11*scale,1.25*scale,armor,'X',8)

def transport():
    hull('Transport / central hull',[(-10,2.1,1.7),(-8,2.8,2.3),(5,2.8,2.3),(8.5,2.1,1.7),(10,1.0,1.0)],0,0,armor)
    # Recognizable two broad troop pods, connected to the command fuselage.
    box('Transport / transverse structural beam',(-2.5,0,-.35),(9,12.8,1.9),armor,.2)
    for side in [-1,1]:
        y=side*5.6
        hull('Troop pod / body',[(-8,1.8,1.8),(-6.6,2.5,2.6),(1.8,2.5,2.6),(3.1,1.8,1.8)],y,-.15,plate)
        for x in [-5.8,.9]:
            # Raised cross-section bands serve as readable structural hoops.
            hull('Troop pod / armor hoop',[(x-.18,2.55,2.65),(x+.18,2.55,2.65)],y,-.15,armor)
        box('Troop pod / faction roof',(-2.4,y,2.52),(5.2,2.45,.12),cyan,.04)
        box('Troop pod / hatch',(-2.4,y+side*2.52,-.05),(2.9,.08,1.4),dark,.08)
        box('Troop pod / hatch center',(-2.4,y+side*2.57,-.05),(.08,.03,1.25),edge,0)
        for x in [-4.7,-3.8,-2.9]:box('Troop pod / roof vents',(x,y,2.62),(.32,1.35,.08),dark,0)
        drive(-8.45,y,-.15,1.35)
    box('Transport / command housing',(5.8,0,2.2),(4.1,3.4,1.3),plate,.3)
    box('Transport / forward bridge',(7.88,0,2.35),(.035,2.2,.18),light,0)
    box('Transport / command accent',(5.8,0,2.91),(2.7,1.3,.1),cyan,.04)
    for side in [-1,1]:windows(4.7,side*1.72,2.4,3)
    box('Transport / spine',(-2,0,2.65),(7.6,2.9,.65),armor,.15)
    box('Transport / spine inset',(-2,0,3.0),(2.6,1.7,.1),plate,.04)
    drive(-10.4,0,0,1.4)

def carrier():
    hull('Carrier / armored lower body',[(-18,6.3,2.6),(-15,8.6,3.7),(11.5,8.6,3.7),(15.5,6.9,2.8),(18,4.6,1.9)],0,-1.1,armor)
    # Deep hangar shoulders define an open central channel, not a warship deck.
    for side in [-1,1]:
        y=side*5.9
        hull('Carrier / hangar shoulder',[(-16,2.0,2.1),(-13.5,2.7,2.8),(10,2.7,2.8),(14,2.2,2.1)],y,1.65,plate)
        for x in [-12,-5,2,9]:
            box('Carrier / hangar roof plate',(x,y,4.53),(5.8,3.3,.15),armor,.07)
            box('Carrier / faction stripe',(x,y+side*.85,4.63),(4.9,.45,.08),cyan,.02)
            # Large dark bays on the outward faces read at small screen sizes.
            box('Carrier / hangar mouth',(x,side*8.62,1.6),(4.7,.07,1.75),dark,.08)
            box('Carrier / bay sill',(x,side*8.68,.7),(4.9,.2,.16),edge,.025)
            box('Carrier / bay indicator',(x+1.8,side*8.68,2.28),(.4,.03,.12),light,0)
        for x in [-8.6,-1.5,5.6]:
            box('Carrier / shoulder seam',(x,y,4.57),(.12,3.4,.09),edge,0)
        turret(10,side*6,4.71,.85)
        turret(-12,side*6,4.71,.85)
    box('Carrier / recessed launch channel',(-.3,0,2.38),(28.5,5.7,.3),dark,.06)
    for side in [-1,1]:
        box('Carrier / launch rail',(.5,side*2.3,2.66),(25,.15,.23),edge,.025)
        for x in [-8,-3,2,7,12]:box('Carrier / deck marker',(x,side*1.6,2.56),(.8,.1,.025),light,0)
    box('Carrier / armored prow',(15,0,1.7),(5.2,7,2.8),plate,.55)
    box('Carrier / bow aperture',(17.65,0,1.65),(.035,4.3,1.3),dark,.05)
    box('Carrier / bow identifier',(15.4,0,3.16),(2.7,2.4,.12),cyan,.03)
    box('Carrier / aft engineering block',(-14,0,2.5),(5,5.3,2.9),armor,.4)
    box('Carrier / command pedestal',(-11.8,0,4.8),(5.2,4.5,2.5),armor,.3)
    box('Carrier / bridge',(-10.8,0,6.4),(4.8,5.2,1.3),plate,.3)
    box('Carrier / bridge front',(-8.38,0,6.5),(.04,3.7,.18),light,0)
    for side in [-1,1]:windows(-12.2,side*2.62,6.5,5)
    box('Carrier / bridge roof',(-10.8,0,7.16),(3.5,3.5,.25),armor,.1)
    box('Carrier / sensor spine',(-11.3,0,7.8),(.45,.45,1.1),edge,.04)
    box('Carrier / sensor crossbar',(-11.3,0,8.35),(.5,2.7,.18),armor,.04)
    for y in [-5.4,-1.8,1.8,5.4]:drive(-18.5,y,-1.1,1.35)
    for side in [-1,1]:
        for x in [-12,-6,0,6,12]:box('Carrier / belt light',(x,side*8.62,-1.1),(.45,.04,.12),light,0)

def platform():
    cyl('Platform / underbody',(0,0,-1.1),5.5,2.0,armor,vertices=16)
    cyl('Platform / rim',(0,0,.05),6,.5,edge,vertices=16)
    cyl('Platform / upper hull',(0,0,.5),5.65,.8,plate,vertices=16)
    cyl('Platform / turntable',(0,0,1.03),3.6,.3,dark,vertices=16)
    cyl('Platform / turret ring',(0,0,1.25),3.2,.3,edge,vertices=12)
    # Segmented outer armor identifies the circular orbital unit.
    for i in range(8):
        a=math.tau*i/8
        obj=box('Platform / ring faction tile',(4.65*math.cos(a),4.65*math.sin(a),1.0),(1.5,1.25,.15),cyan,.06)
        obj.rotation_euler.z=a
    for i in range(4):
        a=math.tau*i/4
        obj=box('Platform / cardinal armor',(6*math.cos(a),6*math.sin(a),.25),(2.3,2.9,2.0),armor,.3)
        obj.rotation_euler.z=a
        obj=box('Platform / cardinal roof',(6*math.cos(a),6*math.sin(a),1.32),(1.5,2.05,.15),plate,.06)
        obj.rotation_euler.z=a
    box('Platform / twin-gun housing',(0,0,2.0),(5,4.2,1.4),plate,.45)
    box('Platform / turret accent',(-.5,0,2.78),(2.8,2.1,.15),cyan,.06)
    for side in [-1,1]:
        cyl('Platform / cannon sleeve',(2.6,side*1.0,2.0),.48,2.2,edge,'X')
        cyl('Platform / cannon barrel',(4.6,side*1.0,2.0),.28,3.1,armor,'X')
        cyl('Platform / muzzle',(6.13,side*1.0,2.0),.38,.55,plate,'X')
        cyl('Platform / bore',(6.42,side*1.0,2.0),.23,.02,dark,'X')
    for y in [-1,0,1]:box('Platform / rear vent',(-2.53,y,2),(.03,.5,.2),dark,0)
    cyl('Platform / bottom reactor',(0,0,-2.2),2.8,.4,dark,vertices=12)
    cyl('Platform / bottom emitter',(0,0,-2.43),1.6,.05,light,vertices=12)

def aim(obj,target=(0,0,0)):
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()

def studio_setup(scale):
    world=bpy.data.worlds.new('Fleet studio');world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.018,.028,.048,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.5;scene.world=world
    for name,pos,energy,color in [('Key',(12,-17,30),6500,(.76,.9,1)),('Rim',(-18,16,22),7500,(.25,.65,1)),('Fill',(20,18,12),4000,(1,.78,.56)),('Belly',(0,-22,0),2500,(.45,.67,1))]:
        d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.color=color;d.shape='DISK';d.size=18
        obj=bpy.data.objects.new(name,d);scene.collection.objects.link(obj);obj.location=pos;aim(obj)
    d=bpy.data.cameras.new('Isometric');d.type='ORTHO';d.ortho_scale=scale
    obj=bpy.data.objects.new('Isometric',d);scene.collection.objects.link(obj);obj.location=(32,-40,31);aim(obj);scene.camera=obj
    scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
    scene.render.resolution_x=1300;scene.render.resolution_y=950;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'

reports=[]
for slug,title,builder,scale,budget in [('transport','Troop transport',transport,30,4500),('carrier','Fleet carrier',carrier,49,6500),('platform','Orbital defense platform',platform,22,3000)]:
    scene=bpy.data.scenes.new('GC • '+title+' low poly');bpy.context.window.scene=scene
    asset_collection=bpy.data.collections.new(title);scene.collection.children.link(asset_collection);parts=[]
    builder()
    root=bpy.data.objects.new('GC_'+slug,None);asset_collection.objects.link(root)
    root['forward']='+X';root['style']='Approved warship v3; current sprite silhouette';root['asset_role']=title
    for obj in parts:
        bpy.context.view_layer.objects.active=obj;obj.select_set(True)
        for mod in list(obj.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
        obj.data.set_sharp_from_angle(angle=math.radians(35));obj.select_set(False);obj.parent=root
    triangles=sum(len(p.vertices)-2 for obj in parts for p in obj.data.polygons)
    if triangles>budget:raise RuntimeError(f'{slug}: {triangles} exceeds budget {budget}')
    studio_setup(scale)
    directory=OUT/slug;directory.mkdir(exist_ok=True)
    bpy.data.libraries.write(str(directory/(slug+'.blend')),{scene},fake_user=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts+[root]:obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(directory/(slug+'.raw.glb')),export_format='GLB',use_selection=True,use_active_scene=True,export_apply=True,export_yup=True,export_cameras=False,export_lights=False)
    reports.append({'asset':slug,'triangles':triangles,'budget':budget,'source_objects':len(parts),'material_slots':6,'forward':'+X','up':'glTF +Y','pivot':'hull center','status':'static model; no game integration'})
    (OUT/'asset-report.json').write_text(json.dumps(reports,indent=2)+'\n')
    scene.render.filepath=str(directory/'isometric.png');bpy.ops.render.render(write_still=True)
    scene.camera.location=(-34,-38,27);aim(scene.camera)
    scene.render.filepath=str(directory/'aft.png');bpy.ops.render.render(write_still=True)
    scene.camera.location=(32,-40,31);aim(scene.camera)
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA'
result={'assets':reports,'output':str(OUT)}
