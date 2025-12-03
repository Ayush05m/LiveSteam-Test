import { MadeWithDyad } from "@/components/made-with-dyad";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GraduationCap, Presentation } from "lucide-react";
import { Link } from "react-router-dom";

const Index = () => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl mb-4 text-gray-900">
          Dyad EduStream
        </h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto">
          Low-latency, cost-optimized live streaming platform for education.
          <br/>
          <span className="text-sm text-gray-500 mt-2 block">
            Powered by LL-HLS • Multi-bitrate H.265/H.264
          </span>
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 max-w-4xl w-full">
        <Link to="/teacher" className="group">
          <Card className="h-full transition-all duration-300 hover:shadow-lg hover:border-primary/50 cursor-pointer">
            <CardHeader>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Presentation className="w-6 h-6 text-blue-600" />
              </div>
              <CardTitle>I am a Teacher</CardTitle>
              <CardDescription>
                Start a class, manage students, and broadcast live video.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full">Go to Dashboard</Button>
            </CardContent>
          </Card>
        </Link>

        <Link to="/student" className="group">
          <Card className="h-full transition-all duration-300 hover:shadow-lg hover:border-green-500/50 cursor-pointer">
            <CardHeader>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <GraduationCap className="w-6 h-6 text-green-600" />
              </div>
              <CardTitle>I am a Student</CardTitle>
              <CardDescription>
                Join a live class, ask questions, and view course materials.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full">Join Class</Button>
            </CardContent>
          </Card>
        </Link>
      </div>
      
      <div className="mt-16">
        <MadeWithDyad />
      </div>
    </div>
  );
};

export default Index;